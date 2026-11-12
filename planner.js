// ===== 「稼ぎたさ」から収入の予定の案を作る =====

// ----- 稼ぎたさ（5段階 ＋ 休み） -----
// 各段階の「枠」＝その月の収入の目安 [下限, 上限]
const LEVEL_BANDS = {
  0: [0, 0],               // 休み
  1: [0, 30000],
  2: [30000, 60000],
  3: [60000, 90000],
  4: [90000, 110000],
  5: [110000, Infinity],   // 上限なし
};
// 選ぶ欄には数字だけ出す（それぞれの金額の幅は、予定金額の画面の説明に書く）
const WEIGHT_CHOICES = [
  [5, "5"],
  [4, "4"],
  [3, "3"],
  [2, "2"],
  [1, "1"],
  [0, "休み"],
];
const DEFAULT_LEVEL = 3;

// 形: { "2026-12": 4, "2027-01": 1 }。入力がない月は DEFAULT_LEVEL
const LEVELS_KEY = "baito-plan-levels";
const OLD_WEIGHTS_KEY = "baito-plan-weights"; // 前のしくみ（3＝稼ぎたい、2＝普通、1＝控えめ、0＝休み）

function loadWeights() {
  try {
    const saved = localStorage.getItem(LEVELS_KEY);
    if (saved) return JSON.parse(saved) || {};

    // 前のしくみの値を、新しい5段階に置き換えて引き継ぐ
    const old = JSON.parse(localStorage.getItem(OLD_WEIGHTS_KEY)) || {};
    const map = { 3: 4, 2: 3, 1: 1, 0: 0 };
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

function weightOf(levels, month) {
  return levels[month] ?? DEFAULT_LEVEL;
}

function bandOf(level) {
  return LEVEL_BANDS[level] || LEVEL_BANDS[DEFAULT_LEVEL];
}

// ----- 枠と稼ぐ量、どちらを優先するか -----
// "band"＝枠を守る（枠の中でできるだけ多く）、"max"＝多く稼ぐ（余裕があれば枠を超えて増やす）
const PLAN_MODE_KEY = "baito-plan-mode";

function loadPlanMode() {
  return localStorage.getItem(PLAN_MODE_KEY) === "max" ? "max" : "band";
}

function savePlanMode(mode) {
  localStorage.setItem(PLAN_MODE_KEY, mode);
}

// ===== 案を作る =====
//   months    : 予定金額の月（Date の配列。1月から始まる年単位）
//   levels    : 各月の稼ぎたさ
//   fixedValue: 決まっている月の金額（3か月平均用。平均外は除く）を返す関数。まだ決まっていない（案を作る）月は null を返す
//   yearFixedValue: 決まっている月の金額（年の合計用。平均外も含む）を返す関数。省略すると fixedValue と同じ
//   mode      : "band" または "max"
//   戻り値    : { "2026-12": 95000, ... }（案を作った月だけ。1,000円単位で切り捨て）
//
// 優先度1（必ず守る）：どの3か月平均も月の上限以下、年の合計も年の上限以下
// そのうえで、少しずつ同時に増やしていく：
//   段階1：全部の月を、枠の下限まで増やす
//   段階2：全部の月を、枠の上限まで増やす
//   段階3（"max" のときだけ）：枠を超えて増やす。稼ぎたさが高い月ほど速く増やす
// どこかで優先度1の上限ちょうどになったら、そこに入っている月はそれ以上増やさない
function proposePlan(months, levels, fixedValue, monthLimit, yearLimit, mode = "band", yearFixedValue = fixedValue) {
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
  fill((k) => bandOf(level(k))[0], () => 1);          // 段階1：枠の下限まで（同じ速さ）
  fill((k) => bandOf(level(k))[1], () => 1);          // 段階2：枠の上限まで（同じ速さ）
  if (mode === "max") {
    fill(() => Infinity, (k) => level(k));            // 段階3：枠を超えて（稼ぎたさが高いほど速く。休みは増やさない）
  }

  const result = {};
  for (const k of free) result[k] = Math.floor(x[k] / 1000) * 1000; // 切り捨てなので上限は超えない
  return result;
}
