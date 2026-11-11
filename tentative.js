// ===== 仮シフト（Google カレンダーに入れる前の、入るつもりのシフト） =====
// このブラウザだけに保存する。計算では、カレンダーのシフトと同じように給料を出して足す
//   ・日付が過ぎた仮シフトは数えない（本当に働いたならカレンダーに入っているはずなので）
//   ・「Google カレンダーに追加」を押すと、カレンダーに予定を作って仮シフトは消える（二重に数えないため）
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

// 過ぎた仮シフトか（数えない）
//   日付で決める：日付が今日より前（今日の分はまだ数える）
//   回数で決める：月が今月より前（今月の分は、月が終わるまで残りの日に割り振って数える）
function isPastTentative(t) {
  if (isCountTentative(t)) return t.month < monthKey(new Date());
  return t.date < dateKey(new Date());
}

// 回数で決めた仮シフトの、計算用の仮の日付 ["2026-12-04", ...]（回数分）
// その月の残りの日（今月なら今日から、先の月なら1日から、月末まで）に均等に割り振る
function countDates(t) {
  if (isPastTentative(t)) return [];
  const today = new Date();
  const first = parseDate(`${t.month}-01`);
  const from = monthKey(today) === t.month ? today.getDate() : 1;
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate(); // 月末の日
  const days = lastDay - from + 1;
  const n = Math.max(0, Math.floor(Number(t.count) || 0));
  const dates = [];
  for (let i = 0; i < n; i++) {
    const day = from + Math.floor(((i + 0.5) * days) / n); // 区間の真ん中あたりの日
    dates.push(dateKey(new Date(first.getFullYear(), first.getMonth(), day)));
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

// 仮シフト → 数えるシフトの配列（日付で決めたものは1つ、回数で決めたものは回数分）。過ぎたものは []
function tentativeShifts(t, workplaces) {
  if (isPastTentative(t)) return [];
  const dates = isCountTentative(t) ? countDates(t) : [t.date];
  return dates.map(d => tentativeToShift(t, workplaces, d)).filter(Boolean);
}

// 回数で決めた仮シフトの、1回分の給料の目安（表示用。月の1日として計算する）
function countSampleShift(t, workplaces) {
  return tentativeToShift(t, workplaces, `${t.month}-01`);
}

// カレンダーの下の「仮シフト」の欄（表示中の月の分）
//   onOpen(t)：仮シフトを押したとき、onAdd()：「＋ 仮シフト」を押したとき
function renderTentatives(container, viewMonth, workplaces, onOpen, onAdd) {
  container.textContent = "";
  const key = monthKey(viewMonth);
  const list = loadTentatives().filter(t => (isCountTentative(t) ? t.month : t.date.slice(0, 7)) === key);

  const head = el("div", "tentative-head");
  const addButton = el("button", "", "＋ 仮シフト");
  addButton.onclick = onAdd;
  head.append(el("h3", "", `${monthName(viewMonth)}の仮シフト`), addButton);
  container.append(
    head,
    el("p", "muted small",
      "まだ Google カレンダーに入れていない、入るつもりのシフトです。" +
      "「来月の収入（予定）」以外の計算（今月の見込み・上限・集計・予定設定）に、カレンダーのシフトと一緒に入ります。" +
      "日付が過ぎた仮シフトは数えません。シフトが決まったら、押して「Google カレンダーに追加」を選ぶと、仮シフトは消えてカレンダーの予定になります。" +
      "日付がまだ決まっていないときは、日付の「未定」にチェックすると、月だけで登録できます（その月の残りの日の真ん中あたりで計算します）。"),
  );

  if (list.length === 0) {
    container.append(el("p", "muted small", "この月の仮シフトはありません。「＋ 仮シフト」から追加できます。"));
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
    if (past) amount = "過ぎた仮シフト（数えない）";
    else if (found) amount = formatYen(shifts.reduce((s, x) => s + x.pay, 0));
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
