// ===== 仮シフト（Google カレンダーに入れる前の、入るつもりのシフト） =====
// このブラウザだけに保存する。計算では、カレンダーのシフトと同じように給料を出して足す
//   ・日付が過ぎた仮シフトも、働いたとして数える（カレンダーに入れ忘れて扶養を超えないように、多めに見る）
//     過ぎたものはカレンダーと一覧で薄い赤にして、「シフトとして追加」か「削除」をしてもらう
//   ・「シフトとして追加」を押すと、カレンダーに予定を作って仮シフトは消える（二重に数えないため）
// 形は2種類（どちらも休憩・ボーナスは、空なら勤怠設定どおり／なし）
//   日付あり　：{ id, date: "2026-12-05", place, role, start: "17:00", end: "22:00", breakMin?, bonus?, bonusNote? }
//   日付が未定：{ id, kind: "count", month: "2026-12", count: 4, place, role, start, end, breakMin?, bonus?, bonusNote? }
//     日付が決まっていないので、計算のときは、その月の残りの日（今月なら今日から月末まで）に
//     均等に割り振った仮の日付で1回ずつ給料を出す（週払い・当日払いでも、振り込まれる月が決まるように）
const TENTATIVE_KEY = "baito-tentative";

function loadTentatives() {
  try {
    return JSON.parse(localStorage.getItem(TENTATIVE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveTentatives(list) {
  localStorage.setItem(TENTATIVE_KEY, JSON.stringify(list));
}

// 追加または更新する（id がなければ新しく作る）
function upsertTentative(t) {
  const list = loadTentatives();
  if (!t.id) t.id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const i = list.findIndex(x => x.id === t.id);
  if (i >= 0) list[i] = t;
  else list.push(t);
  // 並べる順：日付で決めたものは日付、回数で決めたものはその月の最初
  const sortKey = (x) => `${x.kind === "count" ? `${x.month}-00` : x.date}${x.start}`;
  list.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  saveTentatives(list);
}

function removeTentative(id) {
  saveTentatives(loadTentatives().filter(t => t.id !== id));
}

// 回数で決めた仮シフトか
function isCountTentative(t) {
  return t.kind === "count";
}

// 日付が過ぎた仮シフトか（計算には働いたとして入れる。表示を薄い赤にする）
//   日付あり：日付が今日より前
//   日付が未定：入る予定だった月が今月より前（翌月になった）
function isPastTentative(t) {
  if (isCountTentative(t)) return t.month < monthKey(new Date());
  return t.date < dateKey(new Date());
}

// 日付が未定の仮シフトの、計算用の仮の日付 ["2026-12-04", ...]（回数分）
// 働くかもしれない日（remainingDays）に均等に割り振る
function countDates(t) {
  const days = remainingDays(t);
  const n = Math.max(0, Math.floor(Number(t.count) || 0));
  const dates = [];
  for (let i = 0; i < n && days.length > 0; i++) {
    dates.push(days[Math.floor(((i + 0.5) * days.length) / n)]); // 区間の真ん中あたりの日
  }
  return dates;
}

// 仮シフト → 予定の形（カレンダーの表示と、給料の計算に使う）。date を渡すとその日の予定にする
// 終わりが始まりより前なら、次の日に終わる（夜勤など）
function tentativeEvent(t, date = t.date) {
  let endDay = date;
  if (t.end <= t.start) {
    const d = parseDate(date);
    d.setDate(d.getDate() + 1);
    endDay = dateKey(d);
  }
  return {
    summary: t.role ? `${t.place} ${t.role}` : t.place,
    start: { dateTime: new Date(`${date}T${t.start}:00`).toISOString() },
    end: { dateTime: new Date(`${endDay}T${t.end}:00`).toISOString() },
  };
}

// 仮シフトの、予定ごとの設定（予定を押した画面と同じ形）。休憩とボーナスは入力があるときだけ
function tentativeEdit(t) {
  const e = { place: t.place, role: t.role || "-" };
  if (t.breakMin !== undefined && t.breakMin !== null && t.breakMin !== "") e.breakMin = Number(t.breakMin);
  if (Number(t.bonus) > 0) e.bonus = Number(t.bonus);
  if (t.bonusNote) e.bonusNote = t.bonusNote;
  return e;
}

// 仮シフト1回分 → シフト（給料つき）。date を渡すとその日として計算する。バイト先が見つからなければ null
function tentativeToShift(t, workplaces, date = t.date) {
  const shift = eventToShift(tentativeEvent(t, date), workplaces, tentativeEdit(t));
  if (shift) {
    shift.tentative = true;
    shift.tentativeId = t.id;
  }
  return shift;
}

// 日付が未定の仮シフトが働くかもしれない日
//   今月：今日から月末まで、先の月と過ぎた月：1日から月末まで（過ぎた月は、その月のどこかで働いたとして数える）
function remainingDays(t) {
  const today = new Date();
  const first = parseDate(`${t.month}-01`);
  const from = monthKey(today) === t.month ? today.getDate() : 1;
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const days = [];
  for (let day = from; day <= lastDay; day++) days.push(dateKey(new Date(first.getFullYear(), first.getMonth(), day)));
  return days;
}

// 日付が未定の仮シフトで、働く日によって振り込まれる月が変わるとき、その月の一覧 ["2026-12", "2027-01"]
// （週払い・当日払いや、月の途中で締めるバイト先など）。1つに決まるときは長さ1
function possiblePayMonths(t, workplaces) {
  const months = new Set();
  for (const d of remainingDays(t)) {
    const s = tentativeToShift(t, workplaces, d);
    if (s) months.add(s.payDate.slice(0, 7));
  }
  return [...months].sort();
}

// 日付が未定の仮シフトの、計算に使う日付
//   振り込まれる月（payMonth）を選んであれば、その月に振り込まれる日の真ん中あたりの日
//   そうでなければ、その月の残りの日に均等に割り振った日（countDates）
function countShiftDates(t, workplaces) {
  if (t.payMonth && (Number(t.count) || 1) === 1) {
    const days = remainingDays(t).filter(d => {
      const s = tentativeToShift(t, workplaces, d);
      return s && s.payDate.slice(0, 7) === t.payMonth;
    });
    if (days.length > 0) return [days[Math.floor(days.length / 2)]];
  }
  return countDates(t);
}

// 仮シフト → 数えるシフトの配列（日付で決めたものは1つ、回数で決めたものは回数分）。過ぎたものも数える
function tentativeShifts(t, workplaces) {
  const dates = isCountTentative(t) ? countShiftDates(t, workplaces) : [t.date];
  return dates.map(d => tentativeToShift(t, workplaces, d)).filter(Boolean);
}

// 日付が決まっている仮シフトのうち、同じ日・同じバイト先で時間が重なるシフトがもうカレンダーにあるもの
// （Google カレンダーに入れたあとも残ってしまったもの。二重に数えないように消す）
function tentativesInCalendar(tentatives, calendarShifts, workplaces) {
  return tentatives.filter(t => {
    if (isCountTentative(t)) return false;
    const ev = tentativeEvent(t);
    const start = new Date(ev.start.dateTime);
    const end = new Date(ev.end.dateTime);
    const place = (tentativeToShift(t, workplaces) || {}).place || t.place;
    return calendarShifts.some(({ event, shift }) =>
      shift.place === place &&
      new Date(event.start.dateTime) < end && start < new Date(event.end.dateTime));
  });
}

// 回数で決めた仮シフトの、1回分の給料の目安（表示用。月の1日として計算する）
function countSampleShift(t, workplaces) {
  const d = countShiftDates(t, workplaces)[0];
  return tentativeToShift(t, workplaces, d || `${t.month}-01`);
}

// カレンダーの下の「仮シフト」の欄（表示中の月の分）
// 日付が決まっている仮シフトはカレンダーのマスに出るので、ここには日付が未定のものだけを並べる
//   onOpen(t)：仮シフトを押したとき、onAdd()：「＋ 仮シフト」を押したとき
function renderTentatives(container, viewMonth, workplaces, onOpen, onAdd) {
  container.textContent = "";
  const key = monthKey(viewMonth);
  // 今月を見ているときは、入る予定だった月が過ぎた（薄い赤の）ものも出す。シフトとして追加か削除をしてもらうため
  const thisMonth = monthKey(new Date());
  const list = loadTentatives().filter(t => isCountTentative(t) &&
    (t.month === key || (key === thisMonth && t.month < thisMonth)));

  const head = el("div", "tentative-head");
  const addButton = el("button", "", "＋ 仮シフト");
  addButton.onclick = onAdd;
  const { button: helpButton, text: helpText } = helpParts("help:tentative", [
    "仮シフト：まだ Google カレンダーに入れていない、入るつもりのシフトです。このアプリの中だけに保存します。",
    "「来月の収入（予定）」以外の計算（今月の見込み・上限・集計・予定設定）に、カレンダーのシフトと一緒に入ります。",
    "日付が決まっている仮シフトは、カレンダーに点線の枠で出ます。",
    "日付が過ぎた仮シフト（日付が未定のものは、入る予定だった月が過ぎたもの）は薄い赤になります。" +
    "扶養を超えないように、働いたとして計算に入れたままにしています。働いたなら「シフトとして追加」、働かなかったなら「削除」をしてください。",
    "ここには、日付を「未定」にして月だけで登録したものが出ます（その月の残りの日の真ん中あたりで働いたとして計算します）。",
    "週払いなどで、働く日によって振り込まれる月が変わるときは、仮シフトの画面で「振り込まれる月」を選びます。",
    "Google カレンダーに同じ日・同じバイト先・重なる時間のシフトが入ると、その仮シフトは自動で消えます。",
  ]);
  const title = el("div", "help-head");
  title.append(el("h3", "", `${monthName(viewMonth)}の日付未定の仮シフト`), helpButton);
  head.append(title, addButton);
  container.append(head, helpText);

  if (list.length === 0) {
    container.append(el("p", "muted small", "この月の日付未定の仮シフトはありません。「＋ 仮シフト」から追加できます。"));
    return;
  }

  for (const t of list) {
    const past = isPastTentative(t);
    const counted = isCountTentative(t);
    const shifts = tentativeShifts(t, workplaces);
    const found = counted ? !!countSampleShift(t, workplaces) : !!tentativeToShift(t, workplaces);
    const row = el("button", `tentative-row${past ? " past" : ""}${counted ? " count" : ""}`);
    row.type = "button";
    let amount = "バイト先が見つかりません";
    if (found) amount = formatYen(shifts.reduce((s, x) => s + x.pay, 0)) + (past ? "（働いた扱い）" : "");
    // 日付が未定のものは「12月中・日付未定 17:00〜22:00」（前のしくみの何回分かのものは「× 3回」も付ける）
    const when = counted
      ? `${monthName(parseDate(`${t.month}-01`))}中・日付未定 ${t.start}〜${t.end}${Number(t.count) > 1 ? ` × ${t.count}回` : ""}`
      : `${shortDate(t.date)} ${t.start}〜${t.end}`;
    row.append(
      el("span", "tentative-when", when),
      el("span", "tentative-what", t.role ? `${t.place} ${t.role}` : t.place),
      el("span", "value", amount),
    );
    row.onclick = () => onOpen(t);
    container.append(row);
  }
}
