// ===== 「稼ぎたさ」から収入の予定の案を作る =====

// ----- 稼ぎたさ（1〜5 ＋ 0：何円でもいい） -----
// 各段階の「枠」＝その月の収入の目安 [下限, 上限]
// 1・2・3 は「減らしたい月」：多く稼ぐのときも枠の上限までにする
// 0・4・5 は、多く稼ぐのとき、1か月の上限（自分で決める。最初は12万円）まで増やしてよい
// 「0（何円でもいい）」は枠がない月（保存する値は -1）。入力がない月も 0 として扱う
const ANY_LEVEL = -1;
const LEVEL_BANDS = {
  [ANY_LEVEL]: [0, Infinity], // 何円でもいい（枠から外れることはない）
  1: [0, 50000],
  2: [50000, 70000],
  3: [70000, 90000],
  4: [90000, 110000],
  5: [110000, Infinity],   // 上限なし
};
const REDUCE_LEVEL_MAX = 3; // この段階までが「減らしたい月」
// 選ぶ欄には数字だけ出す（それぞれの金額の幅は、予定金額の画面の説明に書く）
const WEIGHT_CHOICES = [
  [5, "5"],
  [4, "4"],
  [3, "3"],
  [2, "2"],
  [1, "1"],
  [ANY_LEVEL, "0"],
];
const DEFAULT_LEVEL = ANY_LEVEL;

// 形: { "2026-12": 4, "2027-01": 1 }。入力がない月は DEFAULT_LEVEL
const LEVELS_KEY = "baito-plan-levels";
const OLD_WEIGHTS_KEY = "baito-plan-weights"; // 前のしくみ（3＝稼ぎたい、2＝普通、1＝控えめ、0＝休み）

function loadWeights() {
  try {
    const saved = localStorage.getItem(LEVELS_KEY);
    if (saved) {
      const levels = JSON.parse(saved) || {};
      // 前にあった「休み」（0）は、一番少ない 1 にする
      for (const k of Object.keys(levels)) if (levels[k] === 0) levels[k] = 1;
      return levels;
    }

    // 前のしくみの値を、新しい5段階に置き換えて引き継ぐ
    const old = JSON.parse(localStorage.getItem(OLD_WEIGHTS_KEY)) || {};
    const map = { 3: 4, 2: 3, 1: 1, 0: 1 };
    const moved = {};
    for (const [month, w] of Object.entries(old)) moved[month] = map[w] ?? DEFAULT_LEVEL;
    localStorage.setItem(LEVELS_KEY, JSON.stringify(moved));
    return moved;
  } catch {
    return {};
  }
}

function setWeight(month, level) {
  const levels = loadWeights();
  levels[month] = level;
  localStorage.setItem(LEVELS_KEY, JSON.stringify(levels));
}

// ----- 金額を固定した月（📌） -----
// 固定した月は、案を作っても上書きせず、決まっている月と同じように扱う（ほかの月をそれに合わせて調整する）
// 形: { "2027-01": true }
const PINNED_KEY = "baito-plan-pinned";

function loadPinned() {
  try {
    return JSON.parse(localStorage.getItem(PINNED_KEY)) || {};
  } catch {
    return {};
  }
}

function setPinned(month, on) {
  const pinned = loadPinned();
  if (on) pinned[month] = true;
  else delete pinned[month];
  localStorage.setItem(PINNED_KEY, JSON.stringify(pinned));
}

function weightOf(levels, month) {
  const v = levels[month] ?? DEFAULT_LEVEL;
  return v === 0 ? 1 : v; // 前にあった「休み」は 1
}

function bandOf(level) {
  return LEVEL_BANDS[level] || LEVEL_BANDS[DEFAULT_LEVEL];
}

// ----- 枠と稼ぐ量、どちらを優先するか -----
// "band"＝枠を守る（枠の中でできるだけ多く）、"max"＝多く稼ぐ（余裕があれば枠を超えて増やす）
const PLAN_MODE_KEY = "baito-plan-mode";
// 1か月に入れる金額の上限（円）。自分で決められる（予定金額設定の画面）。最初は12万円
const MONTH_CAP_KEY = "baito-plan-month-cap";
const DEFAULT_MONTH_CAP = 120000;
function loadMonthCap() {
  const v = Number(localStorage.getItem(MONTH_CAP_KEY));
  return v > 0 ? v : DEFAULT_MONTH_CAP;
}
function saveMonthCap(v) {
  localStorage.setItem(MONTH_CAP_KEY, String(v));
}

function loadPlanMode() {
  return localStorage.getItem(PLAN_MODE_KEY) === "max" ? "max" : "band";
}

function savePlanMode(mode) {
  localStorage.setItem(PLAN_MODE_KEY, mode);
}

// ===== 案を作る（前のやり方。新しい計算がうまくいかなかったときの予備） =====
// 優先度1（必ず守る）：どの3か月平均も月の上限以下、年の合計も年の上限以下
// そのうえで、少しずつ同時に増やしていく：
//   段階1：全部の月を、枠の下限まで増やす
//   段階2：全部の月を、枠の上限まで増やす
//   段階3（"max" のときだけ）：枠を超えて増やす。稼ぎたさが高い月ほど速く増やす
//   段階4：「0（何円でもいい）」の月に、上限まで残った分を入れる（ほかの月がもう増やせなくなってから）
// どこかで優先度1の上限ちょうどになったら、そこに入っている月はそれ以上増やさない
function proposePlanGreedy(months, levels, fixedValue, monthLimit, yearLimit, mode = "band", yearFixedValue = fixedValue) {
  const x = {};       // 各月の金額
  const free = [];    // 案を作る月
  for (const d of months) {
    const key = monthKey(d);
    const fixed = fixedValue(d);
    if (fixed === null) {
      x[key] = 0;
      free.push(key);
    } else {
      x[key] = fixed;
    }
  }
  if (free.length === 0) return {};

  // ----- 優先度1の条件を集める：{ keys: 対象の月, cap: その月たちの合計の上限 } -----
  const constraints = [];
  const inRange = new Set(months.map(monthKey));
  const lastKey = monthKey(months[months.length - 1]);

  // 3か月平均：どの3か月の合計も「月の上限 × 3」まで
  for (const end of months) {
    const window = [addMonths(end, -2), addMonths(end, -1), end];
    if (window.some(d => monthKey(d) > lastKey)) continue;
    const keys = [];
    let outside = 0; // 表より前の月（決まっている金額）
    for (const d of window) {
      const key = monthKey(d);
      if (inRange.has(key)) keys.push(key);
      else outside += fixedValue(d) ?? 0;
    }
    if (keys.some(k => free.includes(k))) constraints.push({ keys, cap: monthLimit * 3 - outside });
  }

  // 年の合計：その年の12か月の合計が「年の上限」まで
  //   年の合計は平均外も含めて数えるので、決まっている月の平均外の分だけ上限を減らす
  const years = [...new Set(months.map(d => d.getFullYear()))];
  for (const y of years) {
    const yearMonths = months.filter(d => d.getFullYear() === y);
    const keys = yearMonths.map(monthKey);
    let outsideAverage = 0; // 決まっている月の、平均外のバイト先の額
    for (const d of yearMonths) {
      const fixed = fixedValue(d);
      if (fixed !== null) outsideAverage += (yearFixedValue(d) ?? fixed) - fixed;
    }
    if (keys.some(k => free.includes(k))) constraints.push({ keys, cap: yearLimit - outsideAverage });
  }

  const sumOf = (c) => c.keys.reduce((s, k) => s + x[k], 0);
  // どこかの条件がもう上限ちょうど（またはそれ以上）なら、その条件に入っている月は増やせない
  const blocked = (key) => constraints.some(c => c.keys.includes(key) && c.cap - sumOf(c) < 0.5);

  // 少しずつ同時に増やす（capOf：その段階でどこまで増やすか、rateOf：増やす速さ）
  const fill = (capOf, rateOf) => {
    const active = new Set(free.filter(k => rateOf(k) > 0 && x[k] < capOf(k) && !blocked(k)));
    for (let step = 0; step < 2000 && active.size > 0; step++) {
      // どれかの月が段階の上限に届くか、どれかの条件が上限ちょうどになるまで、どれだけ増やせるか
      let dt = Infinity;
      for (const k of active) dt = Math.min(dt, (capOf(k) - x[k]) / rateOf(k));
      for (const c of constraints) {
        const rate = c.keys.reduce((s, k) => s + (active.has(k) ? rateOf(k) : 0), 0);
        if (rate > 0) dt = Math.min(dt, Math.max(0, c.cap - sumOf(c)) / rate);
      }
      if (!isFinite(dt)) break;

      for (const k of active) x[k] += rateOf(k) * dt;

      // 止める月：段階の上限に届いた月と、上限ちょうどになった条件に入っている月
      for (const k of [...active]) {
        if (capOf(k) - x[k] < 0.5 || blocked(k)) active.delete(k);
      }
    }
  };

  const level = (k) => weightOf(levels, k);
  const isAny = (k) => level(k) === ANY_LEVEL;
  fill((k) => bandOf(level(k))[0], () => 1);                      // 段階1：枠の下限まで（同じ速さ）
  fill((k) => (isAny(k) ? 0 : bandOf(level(k))[1]), () => 1);    // 段階2：枠の上限まで（同じ速さ。何円でもいい月は待つ）
  if (mode === "max") {
    fill(() => Infinity, (k) => (isAny(k) ? 0 : level(k)));      // 段階3：枠を超えて（稼ぎたさが高いほど速く。休みは増やさない）
  }
  fill(() => Infinity, (k) => (isAny(k) ? 1 : 0));               // 段階4：何円でもいい月に、残った分を全部

  const result = {};
  for (const k of free) result[k] = Math.floor(x[k] / 1000) * 1000; // 切り捨てなので上限は超えない
  return result;
}

// ===== 案を作る =====
//   months    : 予定金額の月（Date の配列。1月から始まる年単位）
//   levels    : 各月の稼ぎたさ
//   fixedValue: 決まっている月の金額（3か月平均用。平均外は除く）を返す関数。まだ決まっていない（案を作る）月は null を返す
//   yearFixedValue: 決まっている月の金額（年の合計用。平均外も含む）を返す関数。省略すると fixedValue と同じ
//   mode      : "band"（枠を守る）または "max"（多く稼ぐ）
//   戻り値    : { "2026-12": 95000, ... }（案を作った月だけ。1,000円単位）
//
// 全部の月を一緒に決める。必ず守るのは、どの3か月平均も月の上限以下・年の合計も年の上限以下
// そのうえで、上から順に大事にする（前のものを悪くしない範囲で、次のものを良くする）
//   枠を守る：どの月も枠の上限まで（0・5 は1か月の上限まで）
//             ① 枠の下限に足りない分をできるだけ少なく
//             ② 年の合計をできるだけ多く
//             ③ 稼ぎたさが高い月に多く入れる（低い月は、ほかで足りるならできるだけ増やさない）
//             ④ 月ごとの金額をできるだけ平らに
//   多く稼ぐ：1・2・3（減らしたい月）は枠の上限まで、0・4・5 は1か月の上限まで
//             稼ぎたさの順序を守る（5の月 ≥ 4の月 ≥ 3の月 ≥ 2の月 ≥ 1の月。0は順序に入れず、1か月の上限までなら何円でもよい）
//             ① 年の合計をできるだけ多く
//             ② 減らしたい月（1・2・3）は、年の合計が変わらない範囲でできるだけ少なく（枠の上限はいつも使い切らない）
//             ③ 稼ぎたさが高い月に多く入れる
//             ④ 月ごとの金額をできるだけ平らに
//   「0（何円でもいい）」の月は枠がないので、合計を増やすために自由に使う
function proposePlan(months, levels, fixedValue, monthLimit, yearLimit, mode = "band", yearFixedValue = fixedValue) {
  try {
    const result = proposePlanLP(months, levels, fixedValue, monthLimit, yearLimit, mode, yearFixedValue);
    if (result) return result;
  } catch (err) {
    console.error(err);
  }
  return proposePlanGreedy(months, levels, fixedValue, monthLimit, yearLimit, mode, yearFixedValue);
}

function proposePlanLP(months, levels, fixedValue, monthLimit, yearLimit, mode, yearFixedValue) {
  const U = 1000; // 計算は千円単位でする（数字を小さくして、計算の誤差を減らすため）
  const level = (k) => weightOf(levels, k);
  const isAny = (k) => level(k) === ANY_LEVEL;

  // 決まっている月の金額と、案を作る月
  const fixed = {};
  const free = [];
  for (const d of months) {
    const key = monthKey(d);
    const f = fixedValue(d);
    if (f === null) free.push(key);
    else fixed[key] = f / U;
  }
  if (free.length === 0) return {};
  const result = {};
  const vars = free;                                          // 金額を決める月
  if (vars.length === 0) return result;
  const at = new Map(vars.map((k, i) => [k, i]));

  // ----- 必ず守る上限：{ keys: 金額を決める月, cap: その月たちの合計の上限（千円） } -----
  const constraints = [];
  const inRange = new Set(months.map(monthKey));
  const lastKey = monthKey(months[months.length - 1]);
  for (const end of months) {
    const window = [addMonths(end, -2), addMonths(end, -1), end];
    if (window.some(d => monthKey(d) > lastKey)) continue;
    let used = 0; // 決まっている分
    const keys = [];
    for (const d of window) {
      const key = monthKey(d);
      if (at.has(key)) keys.push(key);
      else if (inRange.has(key)) used += fixed[key] ?? 0;
      else used += (fixedValue(d) ?? 0) / U; // 表より前の月
    }
    if (keys.length > 0) constraints.push({ keys, cap: Math.max(0, monthLimit * 3 / U - used) });
  }
  for (const y of [...new Set(months.map(d => d.getFullYear()))]) {
    const yearMonths = months.filter(d => d.getFullYear() === y);
    let used = 0; // 決まっている月の額（年の合計なので平均外も含む）
    for (const d of yearMonths) {
      const f = fixedValue(d);
      if (f !== null) used += (yearFixedValue(d) ?? f) / U;
    }
    const keys = yearMonths.map(monthKey).filter(k => at.has(k));
    if (keys.length > 0) constraints.push({ keys, cap: Math.max(0, yearLimit / U - used) });
  }

  // ----- 計算に使う数（変数）を並べて、一番良い金額を探す -----
  const lo = (k) => (isAny(k) ? 0 : bandOf(level(k))[0] / U);
  const hi = (k) => (isAny(k) ? Infinity : bandOf(level(k))[1] / U);
  const n = vars.length;
  // 1か月の上限（千円）
  //   多く稼ぐ：1・2・3（減らしたい月）は枠の上限、0・4・5 は自分で決めた1か月の上限
  //   枠を守る：枠の上限（0 と 5 は枠に上限がないので、自分で決めた1か月の上限）
  const monthCap = loadMonthCap() / U;
  // 稼ぎたさの高さ（1,000円ずつ戻す順番に使う。0：何円でもいい は 3 と同じくらい）
  const order = (k) => (isAny(k) ? 3 : level(k));
  const maxCap = (k) => (!isAny(k) && level(k) <= REDUCE_LEVEL_MAX ? hi(k) : monthCap);
  const bandCap = (k) => Math.min(hi(k), monthCap);

  // m："band"（枠を守る）か "max"（多く稼ぐ）
  // 戻り値：各月の金額（千円、小数のまま）の配列。見つからなければ null
  const solve = (m) => {
    let count = n;
    const underAt = {};   // 枠の下限に足りない分（枠を守るのとき）
    if (m === "band") for (const k of vars) if (lo(k) > 0) underAt[k] = count++;
    // 稼ぎたさの順序（多く稼ぐのとき）：稼ぎたさが1つ上の段階の月は、下の段階の月より少なくしない
    //   段階のあいだに「さかい目」の数を1つ置いて、上の段階の月 ≥ さかい目 ≥ 下の段階の月 にする
    //   順序は 5 ≥ 4 ≥ 3 ≥ 2 ≥ 1。0（何円でもいい）は順序に入れない（1か月の上限までなら何円でもよい）
    const shown = [...new Set(vars.filter(k => !isAny(k)).map(level))].sort((a, b) => b - a);
    const borders = []; // [上の段階, 下の段階, さかい目の番号]
    if (m === "max") for (let i = 0; i + 1 < shown.length; i++) borders.push([shown[i], shown[i + 1], count++]);
    const pairs = [];   // となり合う月（どちらも金額を決める月）と、その差
    for (let i = 0; i + 1 < n; i++) {
      const a = parseDate(vars[i] + "-01");
      if (monthKey(addMonths(a, 1)) === vars[i + 1]) pairs.push([vars[i], vars[i + 1], count++]);
    }
    const nVars = count;
    const vec = () => new Array(nVars).fill(0);

    const rows = [];
    for (const c of constraints) {                                // 3か月平均・年の合計の上限
      const a = vec();
      for (const k of c.keys) a[at.get(k)] = 1;
      rows.push({ a, op: "<=", b: c.cap });
    }
    for (const k of vars) {
      const i = at.get(k);
      {                                                           // 1か月の上限（上の maxCap・bandCap）
        const a = vec(); a[i] = 1;
        rows.push({ a, op: "<=", b: m === "max" ? maxCap(k) : bandCap(k) });
      }
      if (k in underAt) {                                         // x + 足りない分 ≥ 下限
        const a = vec(); a[i] = 1; a[underAt[k]] = 1;
        rows.push({ a, op: ">=", b: lo(k) });
      }
    }
    for (const [upper, lower, t] of borders) {                    // 上の段階の月 ≥ さかい目 ≥ 下の段階の月
      for (const k of vars) {
        if (isAny(k)) continue;
        const a = vec();
        if (order(k) === upper) { a[at.get(k)] = 1; a[t] = -1; rows.push({ a, op: ">=", b: 0 }); }
        if (order(k) === lower) { a[at.get(k)] = -1; a[t] = 1; rows.push({ a, op: ">=", b: 0 }); }
      }
    }
    for (const [p, q, j] of pairs) {                              // |x_p − x_q| ≤ 差
      const a1 = vec(); a1[at.get(p)] = 1; a1[at.get(q)] = -1; a1[j] = -1;
      const a2 = vec(); a2[at.get(p)] = -1; a2[at.get(q)] = 1; a2[j] = -1;
      rows.push({ a: a1, op: "<=", b: 0 }, { a: a2, op: "<=", b: 0 });
    }

    // 大事にすること（大きくしたい量）。上から順に、前の結果を悪くしない範囲で良くする
    const total = vec();
    for (const k of vars) total[at.get(k)] = 1;
    const lessUnder = vec();
    for (const k in underAt) lessUnder[underAt[k]] = -1;
    const pref = vec();         // 稼ぎたさが高い月に多く（低い月ほど「増やすと損」が大きい）
    for (const k of vars) pref[at.get(k)] = -(isAny(k) ? 3 : 6 - level(k));
    const flatter = vec();
    for (const [, , j] of pairs) flatter[j] = -1;
    // 減らしたい月（1・2・3）は、年の合計が変わらない範囲で、できるだけ少なく（1がいちばん強く減らす）
    const lessReduce = vec();
    for (const k of vars) if (!isAny(k) && level(k) <= REDUCE_LEVEL_MAX) lessReduce[at.get(k)] = -(REDUCE_LEVEL_MAX + 1 - level(k));
    const goals = m === "max" ? [total, lessReduce, pref, flatter] : [lessUnder, total, pref, flatter];

    let x = null;
    for (const goal of goals) {
      const solved = solveLP(nVars, goal, rows);
      if (!solved) return null;
      x = solved.x;
      // この結果を悪くしないように、次からの計算の条件に入れる
      rows.push({ a: goal, op: ">=", b: solved.value - 1e-4 * Math.max(1, Math.abs(solved.value)) });
    }
    return x.slice(0, n);
  };

  // 枠を守る：枠の中で。多く稼ぐ：枠は気にせず、稼ぎたさの順序だけ守って
  const x = solve(mode);
  if (!x) return null;

  // ----- 1,000円単位にする：まず切り捨て、余った分を上限を超えない範囲で1,000円ずつ戻す -----
  const amount = {};
  for (const k of vars) amount[k] = Math.max(0, Math.floor(x[at.get(k)] + 1e-6));
  const slack = (c) => c.cap - c.keys.reduce((s, k) => s + amount[k], 0);
  const backOrder = [...vars].sort((a, b) => order(b) - order(a)); // 稼ぎたさが高い月から戻す
  for (let changed = true; changed;) {
    changed = false;
    for (const k of backOrder) {
      if (amount[k] + 1 > x[at.get(k)] + 1) continue;                     // 計算した額より1,000円以上多くはしない
      if (amount[k] + 1 > (mode === "max" ? maxCap(k) : bandCap(k)) + 1e-9) continue;
      // 多く稼ぐ：稼ぎたさが上の月より多くしない（稼ぎたさの順序を守る）
      if (mode === "max" && !isAny(k) &&
          vars.some(o => !isAny(o) && level(o) > level(k) && amount[k] + 1 > amount[o])) continue;
      if (constraints.some(c => c.keys.includes(k) && slack(c) < 1 - 1e-9)) continue;
      amount[k] += 1;
      changed = true;
    }
  }
  for (const k of vars) result[k] = amount[k] * U;
  return result;
}

// ===== 線形計画法（シンプレックス法） =====
// nVars 個の数 x（どれも0以上）について、rows の条件（a・x ≤ / ≥ / = b）を守りながら objective・x を一番大きくする
// 戻り値：{ x, value }。条件を全部守れないときは null
function solveLP(nVars, objective, rows) {
  const EPS = 1e-9;
  const flip = { "<=": ">=", ">=": "<=", "=": "=" };
  const R = rows.map(r => (r.b < 0 ? { a: r.a.map(v => -v), op: flip[r.op], b: -r.b } : r));
  const m = R.length;
  let nSlack = 0;
  let nArt = 0;
  for (const r of R) {
    if (r.op !== "=") nSlack++;
    if (r.op !== "<=") nArt++;
  }
  const N = nVars + nSlack + nArt;
  const T = [];
  const basis = [];
  const isArt = new Set();
  let s = nVars;
  let art = nVars + nSlack;
  for (const r of R) {
    const row = new Float64Array(N + 1);
    for (let j = 0; j < nVars; j++) row[j] = r.a[j] || 0;
    row[N] = r.b;
    if (r.op === "<=") { row[s] = 1; basis.push(s); s++; }
    else {
      if (r.op === ">=") { row[s] = -1; s++; }
      row[art] = 1; basis.push(art); isArt.add(art); art++;
    }
    T.push(row);
  }
  const pivot = (pr, pc) => {
    const prow = T[pr];
    const p = prow[pc];
    for (let j = 0; j <= N; j++) prow[j] /= p;
    for (let i = 0; i < m; i++) {
      if (i === pr) continue;
      const f = T[i][pc];
      if (Math.abs(f) > EPS) {
        const row = T[i];
        for (let j = 0; j <= N; j++) row[j] -= f * prow[j];
      }
    }
    basis[pr] = pc;
  };
  // c を一番大きくする（Bland の決まりで、同じところを回り続けないようにする）
  const run = (c, allowed) => {
    for (let iter = 0; iter < 20000; iter++) {
      let pc = -1;
      for (let j = 0; j < N; j++) {
        if (!allowed(j)) continue;
        let rc = c[j];
        for (let i = 0; i < m; i++) if (c[basis[i]]) rc -= c[basis[i]] * T[i][j];
        if (rc > 1e-7) { pc = j; break; }
      }
      if (pc < 0) return true;
      let pr = -1;
      let best = Infinity;
      for (let i = 0; i < m; i++) {
        if (T[i][pc] > EPS) {
          const ratio = T[i][N] / T[i][pc];
          if (pr < 0 || ratio < best - EPS || (Math.abs(ratio - best) <= EPS && basis[i] < basis[pr])) {
            best = ratio;
            pr = i;
          }
        }
      }
      if (pr < 0) return false; // いくらでも大きくできる（ここでは起きない）
      pivot(pr, pc);
    }
    return false;
  };
  if (isArt.size > 0) {
    const c1 = new Array(N).fill(0);
    for (const j of isArt) c1[j] = -1;
    run(c1, () => true);
    let left = 0;
    for (let i = 0; i < m; i++) if (isArt.has(basis[i])) left += T[i][N];
    if (left > 1e-6) return null;
    for (let i = 0; i < m; i++) {
      if (!isArt.has(basis[i])) continue;
      for (let j = 0; j < N; j++) {
        if (!isArt.has(j) && Math.abs(T[i][j]) > EPS) { pivot(i, j); break; }
      }
    }
  }
  const c2 = new Array(N).fill(0);
  for (let j = 0; j < nVars; j++) c2[j] = objective[j] || 0;
  if (!run(c2, (j) => !isArt.has(j))) return null;
  const x = new Array(nVars).fill(0);
  for (let i = 0; i < m; i++) if (basis[i] < nVars) x[basis[i]] = T[i][N];
  return { x, value: x.reduce((sum, v, j) => sum + v * (objective[j] || 0), 0) };
}
