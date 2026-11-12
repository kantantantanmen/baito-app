// ===== 月ごとの収入（確定額・カレンダー・予定金額をまとめる） =====
// 画面に出す金額は、すべて「◯月の収入」＝その月に振り込まれる額で数える。
// シフトは、バイト先の締め日・給料日から出した振込日の月に入る
// （同じ11月に働いても、当月払いなら11月の収入、翌月払いなら12月の収入）

// 月を n か月ずらしたキーにして、データを引き継ぐための関数
function shiftKeys(data, n) {
  const moved = {};
  for (const [month, value] of Object.entries(data)) {
    moved[monthKey(addMonths(parseDate(`${month}-01`), n))] = value;
  }
  return moved;
}

// ----- 確定額 -----
// 形: { "2026-11": { "カフェ": 54321, "塾": 16000 }, ... }  キーは「収入の月」（振り込まれる月）
const CONFIRMED_KEY = "baito-confirmed-pay";
const WORK_CONFIRMED_KEY = "baito-confirmed-work"; // 1つ前のしくみ（キーが働いた月）
const OLD_CONFIRMED_KEY = "baito-confirmed";        // 最初のしくみ（キーが振込月）

function loadConfirmed() {
  try {
    const saved = localStorage.getItem(CONFIRMED_KEY);
    if (saved) return JSON.parse(saved) || {};

    // 前のしくみのデータがあれば引き継ぐ
    let moved = {};
    const work = localStorage.getItem(WORK_CONFIRMED_KEY);
    if (work) {
      moved = shiftKeys(JSON.parse(work) || {}, 1); // 働いた月 → 振り込まれる月（1か月後）
    } else {
      moved = JSON.parse(localStorage.getItem(OLD_CONFIRMED_KEY)) || {};
    }
    localStorage.setItem(CONFIRMED_KEY, JSON.stringify(moved));
    return moved;
  } catch {
    return {};
  }
}

// month（収入の月）の place の確定額を保存する。amount が null なら確定を取り消す
function setConfirmed(month, place, amount) {
  const data = loadConfirmed();
  if (!data[month]) data[month] = {};
  if (amount === null) {
    delete data[month][place];
    if (Object.keys(data[month]).length === 0) delete data[month];
  } else {
    data[month][place] = amount;
  }
  localStorage.setItem(CONFIRMED_KEY, JSON.stringify(data));
}

// ----- もう勤務が入らない月の、カレンダーの額での自動確定 -----
// 金額は確定額と同じ所（CONFIRMED_KEY）に入れ、計算上は自分で確定したものと同じに扱う。
// どれが自動か・自動で確定しないもの（取り消されたもの）は、別に覚えておく
// 形: { "2026-10": ["塾", "カフェ"], ... }
const AUTO_KEY = "baito-auto-confirmed";
const AUTO_SKIP_KEY = "baito-auto-skip";

function loadMonthLists(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch {
    return {};
  }
}

function saveMonthLists(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

function inMonthList(data, month, place) {
  return (data[month] || []).includes(place);
}

function setInMonthList(data, month, place, on) {
  const list = new Set(data[month] || []); // Set：重複なしの集まり
  if (on) list.add(place);
  else list.delete(place);
  if (list.size > 0) data[month] = [...list];
  else delete data[month];
}

// month の place が、自動で確定されたものか
function isAutoConfirmed(month, place) {
  return inMonthList(loadMonthLists(AUTO_KEY), month, place);
}

// 収入確定の画面で、自分で確定・取り消しをしたときに呼ぶ：自動の印を外す
// （取り消した月がもう締まっていれば、次に描き直すときにカレンダーの額で自動確定に戻る）
function markManual(month, place) {
  const auto = loadMonthLists(AUTO_KEY);
  setInMonthList(auto, month, place, false);
  saveMonthLists(AUTO_KEY, auto);
}

// 自動確定のタイミングを選べるバイト先か（翌月払い以外：週払い・当月払い・翌々月払い）
//   当日払いは、どちらを選んでも「月が終わったとき」になるので選ばない
function hasAutoTimingChoice(w) {
  if (w.payCycle === "week") return true;
  return w.payCycle === "month" && w.payMonthOffset !== 1;
}

// バイト先 w で、自動確定してよい「収入の月」の最後の月（"2026-11"）を返す
// w.autoConfirmTiming（hasAutoTimingChoice のバイト先だけ選べる）：
//   "pay"     ：もう新しい勤務が入らなくなったらすぐ
//               今日働いた分の振込日が12月なら、今日から先に働いても11月以前の収入にはならない
//               → 11月までの収入は、もう増えない
//   "monthEnd"：その収入の月が終わったら（11月の収入は12月1日に）
// 例：月末締め翌月払い … 11月1日になった時点で、11月の収入（10月の勤務）が決まる
//     翌週払い（すぐ） … 今日の勤務の振込日が来月になった時点で、今月の収入が決まる
//     翌々月払い（すぐ）… 11月1日になった時点で、12月の収入（10月の勤務）が決まる
//     当日払い         … 月が終わった時点で決まる（どちらを選んでも同じ）
function lastClosedMonth(w, today = new Date()) {
  const payToday = payDateFor(today, w);
  const closed = monthKey(addMonths(new Date(payToday.getFullYear(), payToday.getMonth(), 1), -1));
  if (hasAutoTimingChoice(w) && w.autoConfirmTiming === "monthEnd") {
    const lastMonth = monthKey(addMonths(new Date(today.getFullYear(), today.getMonth(), 1), -1));
    return lastMonth < closed ? lastMonth : closed;
  }
  return closed;
}

// 自動確定してよい収入の月（lastClosedMonth まで）で、まだ確定していないバイト先を、カレンダーの額で自動確定する
//   シフトが1回もなければ0円
//   income    ：incomeByMonth の結果
//   workplaces：バイト先の一覧
//   firstMonth：対象にする最初の月のキー（カレンダーの予定がそろっている月から）
// 自動で確定した額は、カレンダーを直したら一緒に変わる（自分で確定したものは変えない）。
// 設定を変えて、まだ自動確定してはいけない月になったものは取り消す。変更があったら true を返す
function autoConfirmClosed(income, workplaces, firstMonth) {
  const confirmed = loadConfirmed();
  const auto = loadMonthLists(AUTO_KEY);
  let changed = false;

  // 前のしくみの「自動で確定しない」リストは使わない（締まった月は必ず確定にする）ので消す
  if (localStorage.getItem(AUTO_SKIP_KEY) !== null) {
    localStorage.removeItem(AUTO_SKIP_KEY);
    changed = true;
  }

  for (const w of workplaces) {
    if (!w.name) continue;
    const last = lastClosedMonth(w);

    for (let d = parseDate(`${firstMonth}-01`); monthKey(d) <= last; d = addMonths(d, 1)) {
      const month = monthKey(d);
      const isAuto = inMonthList(auto, month, w.name);
      const hasConfirmed = confirmed[month] !== undefined && w.name in confirmed[month];
      if (hasConfirmed && !isAuto) continue;               // 自分で確定したもの → そのまま

      const estimate = ((income[month] || {})[w.name] || {}).estimate || 0; // カレンダーからの額
      if (!hasConfirmed || confirmed[month][w.name] !== estimate) {
        if (!confirmed[month]) confirmed[month] = {};
        confirmed[month][w.name] = estimate;
        setInMonthList(auto, month, w.name, true);
        changed = true;
      }
    }

    // まだ締まっていない月の確定は外す（自動確定も、前に自分で確定したものも）
    //   設定を変えて締まる時期が変わったときも、ここで外れる
    //   今月なら見込み、先の月なら未確定（カレンダーの額）に戻る
    for (const month of Object.keys(confirmed)) {
      if (month > last && w.name in confirmed[month]) {
        delete confirmed[month][w.name];
        if (Object.keys(confirmed[month]).length === 0) delete confirmed[month];
        changed = true;
      }
    }
    for (const month of Object.keys(auto)) {
      if (month > last && inMonthList(auto, month, w.name)) {
        setInMonthList(auto, month, w.name, false);
        changed = true;
      }
    }
  }

  if (changed) {
    localStorage.setItem(CONFIRMED_KEY, JSON.stringify(confirmed));
    saveMonthLists(AUTO_KEY, auto);
  }
  return changed;
}

// ----- 予定金額（年と月ごと。「◯月の収入」の予定） -----
// 形: { "2026-12": 100000, "2027-01": 80000 }
const PLANS_KEY = "baito-plans-ym";
const MONTHLY_PLANS_KEY = "baito-plans-income"; // 1つ前のしくみ（年に関係なく "01"〜"12"）

function loadPlans() {
  try {
    const saved = localStorage.getItem(PLANS_KEY);
    if (saved) return JSON.parse(saved) || {};

    // 1つ前のしくみのデータがあれば、今年と来年の同じ月の両方に引き継ぐ
    const monthly = JSON.parse(localStorage.getItem(MONTHLY_PLANS_KEY)) || {};
    const year = new Date().getFullYear();
    const moved = {};
    for (const [mm, amount] of Object.entries(monthly)) {
      moved[`${year}-${mm}`] = amount;
      moved[`${year + 1}-${mm}`] = amount;
    }
    localStorage.setItem(PLANS_KEY, JSON.stringify(moved));
    return moved;
  } catch {
    return {};
  }
}

// month: "2026-12"。amount が null なら消す
function setPlan(month, amount) {
  const plans = loadPlans();
  if (amount === null) delete plans[month];
  else plans[month] = amount;
  localStorage.setItem(PLANS_KEY, JSON.stringify(plans));
}

// "2026-12" → その月の予定金額の金額（なければ undefined）
function planFor(plans, month) {
  return plans[month];
}

// ===== 収入の月（振り込まれる月）・バイト先ごとにまとめる =====
// 戻り値: { "2026-11": { "カフェ": 1件分, ... }, ... }
// 1件分: { place, estimate（カレンダーからの額）, confirmed（確定額 or null）, value（使う額）,
//          auto（自動確定か）, expected（今月の見込みか）, tentative / tentativeCount（そのうち仮シフトの額・回数）,
//          count（勤務回数）, minutes（実働の分）, payDate（振込予定日）,
//          firstDay, lastDay（この収入になる勤務の最初と最後の日）, inAverage }
function incomeByMonth(shifts, workplaces, confirmed) {
  const result = {};

  const get = (month, place) => {
    if (!result[month]) result[month] = {};
    if (!result[month][place]) {
      const wp = workplaces.find(w => w.name === place);
      result[month][place] = {
        place, estimate: 0, confirmed: null, auto: false, expected: false,
        tentative: 0, tentativeCount: 0, // そのうち仮シフトの額と回数
        value: 0, count: 0, minutes: 0,
        payDate: null, payDates: [], firstDay: null, lastDay: null,
        inAverage: wp ? wp.inAverage : true,
      };
    }
    return result[month][place];
  };

  // カレンダー（と仮シフト）から計算した額を、振り込まれる月ごとに足していく
  // （s.payDate はバイト先設定の締め日・給料日から出した振込日。当月払い・翌月払いでここが変わる）
  for (const s of shifts) {
    const r = get(s.payDate.slice(0, 7), s.place);
    r.estimate += s.pay;
    r.count += 1;
    if (s.tentative) {
      r.tentative += s.pay;
      r.tentativeCount += 1;
    }
    r.minutes += s.workMin;
    if (!r.payDate || s.payDate > r.payDate) r.payDate = s.payDate;
    if (!r.payDates.includes(s.payDate)) r.payDates.push(s.payDate); // 週払い・当日払いは何回もある
    if (!r.firstDay || s.day < r.firstDay) r.firstDay = s.day;
    if (!r.lastDay || s.day > r.lastDay) r.lastDay = s.day;
  }

  // 確定額を書き込む（自動で確定したものには auto の印を付ける。計算上は同じ）
  const auto = loadMonthLists(AUTO_KEY);
  for (const [month, places] of Object.entries(confirmed)) {
    for (const [place, amount] of Object.entries(places)) {
      const r = get(month, place);
      r.confirmed = amount;
      r.auto = inMonthList(auto, month, place);
    }
  }

  // 登録しているバイト先は、シフトがない月にも0円の行を入れておく
  // （「全部確定したか」を、まだシフトが入っていないバイト先も含めて判定するため）
  const thisMonth = monthKey(new Date());
  if (!result[thisMonth]) result[thisMonth] = {}; // 今月は見込みを出すので必ず作る
  for (const month of Object.keys(result)) {
    for (const w of workplaces) {
      if (w.name) get(month, w.name);
    }
  }

  // 今月の収入で、まだ増えるバイト先は「見込み」で自動確定する（計算上は確定と同じ）
  //   見込みの額 ＝ カレンダー＋仮シフトの額（shifts に仮シフトが入っていれば）
  //   収入が増えなくなったら（lastClosedMonth を過ぎたら）、カレンダーの額での自動確定に切り替わる
  for (const w of workplaces) {
    if (!w.name) continue;
    const r = get(thisMonth, w.name);
    if (r.confirmed !== null || lastClosedMonth(w) >= thisMonth) continue; // 確定済み・もう増えない
    r.expected = true;
    r.confirmed = r.estimate;
  }

  // 使う額：確定していれば確定額、まだならカレンダー（＋仮シフト）からの額
  for (const places of Object.values(result)) {
    for (const r of Object.values(places)) r.value = r.confirmed ?? r.estimate;
  }
  return result;
}

// ある月の一覧（バイト先の名前順）
function monthRows(income, month) {
  return Object.values(income[month] || {}).sort((a, b) => a.place.localeCompare(b.place));
}

// ===== 月の金額を決める =====
// month（収入の月 "2026-12"）の金額と、その出どころを返す
//   "calendar"（カレンダー優先）：
//       確定したバイト先は確定額、確定していないバイト先はカレンダー（＋仮シフト）から計算した額。
//       確定もカレンダーのシフトもない月（仮シフトしか入っていない月も）だけ予定金額（入力があれば）
//   "plan"（予定金額優先）：
//       予定金額に入力があれば、一部確定していても予定金額の金額。入力がない月はカレンダー優先と同じ
//   全部確定した月と今月までの月は、どちらでも確定額（予定金額は使わない）
//   → 違いが出るのは、来月から先で全部は確定していない月だけ
//   画面の計算はどこも "calendar"。"plan" は集計の年の表の「予定金額優先」の列だけで使う
// 戻り値: { value: 金額, source: "plan" または "actual", confirmed: そのうち確定した額,
//          hasConfirmed: 確定したバイト先があるか（0円で確定した場合も true）,
//          allConfirmed: その月のバイト先が全部確定しているか,
//          autoCount, manualCount, expectCount: 自動確定／自分で確定／見込みのバイト先の数（表示用）,
//          expected: そのうち見込みの額 }
// 見込み（今月のまだ増える分）も、計算上は確定と同じに扱う
// onlyAverage のときは、3か月平均に入れないバイト先の額を足さない。
// ただし予定金額を使うかの判定には数える（平均外のシフトだけでも「カレンダーあり」）。
// そのときの0円は outsideOnly（平均外のみ）で見分ける
function monthInfo(income, plans, month, onlyAverage = false, priority = "calendar") {
  const allRows = monthRows(income, month);
  const hasConfirmed = allRows.some(r => r.confirmed !== null);
  const allConfirmed = allRows.length > 0 && allRows.every(r => r.confirmed !== null);
  const autoCount = allRows.filter(r => r.confirmed !== null && r.auto).length;
  const expectCount = allRows.filter(r => r.expected).length;
  const manualCount = allRows.filter(r => r.confirmed !== null && !r.auto && !r.expected).length;
  const rows = allRows.filter(r => r.value > 0);
  const plan = planFor(plans, month);

  if (plan != null && !allConfirmed && month > monthKey(new Date())) {
    // 予定金額優先なら一部確定があっても予定金額。
    // カレンダー優先なら、確定もカレンダーのシフトもない月（仮シフトしか入っていない月も）だけ予定金額
    // 全部確定した月と、今月までの月（確定・自動確定・見込みを使う）は、ここに来ない
    const calendarRows = rows.filter(r => r.count > r.tentativeCount); // カレンダーのシフトがあるバイト先
    const usePlan = priority === "plan" || (!hasConfirmed && calendarRows.length === 0);
    if (usePlan) {
      return { value: plan, source: "plan", confirmed: 0, hasConfirmed: false, allConfirmed: false,
               autoCount: 0, manualCount: 0, expectCount: 0, expected: 0 };
    }
  }

  let value = 0;
  let confirmed = 0;
  let expected = 0;
  for (const r of rows) {
    if (onlyAverage && !r.inAverage) continue;
    value += r.value;
    if (r.confirmed !== null) confirmed += r.value;
    if (r.expected) expected += r.value;
  }
  // 平均外のバイト先の額しかなくて、平均の計算では0円になる月
  const outsideOnly = onlyAverage && value === 0 && rows.some(r => !r.inAverage);
  return { value, source: "actual", confirmed, hasConfirmed, allConfirmed,
           autoCount, manualCount, expectCount, expected, outsideOnly };
}

// ===== 3か月平均が上限を超える期間 =====
// months の各月について「2か月前〜その月」の3か月平均を出し、上限を超えていたら
// その3か月を集める。戻り値は月のキー（"2026-12"）の Set（重複なしの集まり）
function overLimitMonths(months, valueOf, limit) {
  const keys = new Set();
  for (const m of months) {
    const window = [addMonths(m, -2), addMonths(m, -1), m];
    const avg = window.reduce((sum, d) => sum + valueOf(d), 0) / 3;
    if (avg > limit) {
      for (const d of window) keys.add(monthKey(d));
    }
  }
  return keys;
}

// ===== その月の収入の上限 =====
// month（収入の月）について、次の3つのうち一番小さい（きびしい）ものが上限
//   (1) 2か月前〜その月の3か月平均から：上限×3 −（2か月前 ＋ 前の月）
//   (2) 前の月〜次の月の3か月平均から  ：上限×3 −（前の月 ＋ 次の月）
//   (3) 予定金額のその月の金額（入力があれば）
// valueOf(d)：月 d の金額を返す関数
// 戻り値: { windows: [{ months, cap }, { months, cap }], plan, windowMin（(1)(2)の小さい方）, min（全体） }
function capForMonth(month, valueOf, limit, plans) {
  const windows = [];
  for (const offset of [-2, -1]) {
    const months = [addMonths(month, offset), addMonths(month, offset + 1), addMonths(month, offset + 2)];
    let others = 0; // month 以外の2か月の合計
    for (const m of months) {
      if (monthKey(m) !== monthKey(month)) others += valueOf(m);
    }
    windows.push({ months, cap: limit * 3 - others });
  }
  const windowMin = Math.min(...windows.map(w => w.cap)); // ... は配列をばらして渡す書き方
  const plan = planFor(plans, monthKey(month));
  const min = plan != null ? Math.min(windowMin, plan) : windowMin;
  return { windows, plan, windowMin, min };
}
