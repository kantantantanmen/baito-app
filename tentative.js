// ===== 仮シフト（Google カレンダーに入れる前の、入るつもりのシフト） =====
// このブラウザだけに保存する。計算では、カレンダーのシフトと同じように給料を出して足す
//   ・日付が過ぎた仮シフトは数えない（本当に働いたならカレンダーに入っているはずなので）
//   ・「Google カレンダーに追加」を押すと、カレンダーに予定を作って仮シフトは消える（二重に数えないため）
// 形: [{ id, date: "2026-12-05", place: "カフェ", role: "", start: "17:00", end: "22:00" }, ...]
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
  list.sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
  saveTentatives(list);
}

function removeTentative(id) {
  saveTentatives(loadTentatives().filter(t => t.id !== id));
}

// 日付が過ぎた仮シフトか（今日の分はまだ数える）
function isPastTentative(t) {
  return t.date < dateKey(new Date());
}

// 仮シフト → 予定の形（カレンダーの表示と、給料の計算に使う）
// 終わりが始まりより前なら、次の日に終わる（夜勤など）
function tentativeEvent(t) {
  let endDay = t.date;
  if (t.end <= t.start) {
    const d = parseDate(t.date);
    d.setDate(d.getDate() + 1);
    endDay = dateKey(d);
  }
  return {
    summary: t.role ? `${t.place} ${t.role}` : t.place,
    start: { dateTime: new Date(`${t.date}T${t.start}:00`).toISOString() },
    end: { dateTime: new Date(`${endDay}T${t.end}:00`).toISOString() },
  };
}

// 仮シフト → シフト（給料つき）。バイト先が見つからなければ null
function tentativeToShift(t, workplaces) {
  const shift = eventToShift(tentativeEvent(t), workplaces, { place: t.place, role: t.role || "-" });
  if (shift) {
    shift.tentative = true;
    shift.tentativeId = t.id;
  }
  return shift;
}

// カレンダーの下の「仮シフト」の欄（表示中の月の分）
//   onOpen(t)：仮シフトを押したとき、onAdd()：「＋ 仮シフト」を押したとき
function renderTentatives(container, viewMonth, workplaces, onOpen, onAdd) {
  container.textContent = "";
  const key = monthKey(viewMonth);
  const list = loadTentatives().filter(t => t.date.slice(0, 7) === key);

  const head = el("div", "tentative-head");
  const addButton = el("button", "", "＋ 仮シフト");
  addButton.onclick = onAdd;
  head.append(el("h3", "", `${monthName(viewMonth)}の仮シフト`), addButton);
  container.append(
    head,
    el("p", "muted small",
      "まだ Google カレンダーに入れていない、入るつもりのシフトです。" +
      "「来月の収入（予定）」以外の計算（今月の見込み・上限・集計・予定設定）に、カレンダーのシフトと一緒に入ります。" +
      "日付が過ぎた仮シフトは数えません。シフトが決まったら、押して「Google カレンダーに追加」を選ぶと、仮シフトは消えてカレンダーの予定になります。"),
  );

  if (list.length === 0) {
    container.append(el("p", "muted small", "この月の仮シフトはありません。「＋ 仮シフト」から追加できます。"));
    return;
  }

  for (const t of list) {
    const past = isPastTentative(t);
    const shift = tentativeToShift(t, workplaces);
    const row = el("button", `tentative-row${past ? " past" : ""}`);
    row.type = "button";
    let amount = "バイト先が見つかりません";
    if (past) amount = "過ぎた仮シフト（数えない）";
    else if (shift) amount = formatYen(shift.pay);
    row.append(
      el("span", "tentative-when", `${shortDate(t.date)} ${t.start}〜${t.end}`),
      el("span", "tentative-what", t.role ? `${t.place} ${t.role}` : t.place),
      el("span", "value", amount),
    );
    row.onclick = () => onOpen(t);
    container.append(row);
  }
}
