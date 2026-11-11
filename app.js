// ===== 画面の部品 =====
const grid = document.getElementById("calendar-grid");
const monthLabel = document.getElementById("month-label");
const message = document.getElementById("message");
const calendarSelect = document.getElementById("calendar-select");
const summaryPanel = document.getElementById("summary");
const settingsView = document.getElementById("settings");
const confirmView = document.getElementById("confirm");
const planView = document.getElementById("plan");
const statsView = document.getElementById("stats");
const tentativeView = document.getElementById("tentative");
const dayListView = document.getElementById("day-list");

const SELECTED_KEY = "baito-calendars"; // 選んだカレンダーの保存名

let calendars = [];      // ログイン後に取ってきたカレンダーの一覧
let items = [];          // 取ってきた予定 [{ event, cal, shift }, ...]
let loadedStart = null;  // items を取ってきた期間の始まり（読み込めていなければ null）
let isLoggedIn = false;
let loadCount = 0;       // 古い読み込み結果で上書きしないための番号
let currentView = "calendar"; // 今の画面："calendar"、"stats"、"plan"、"confirm"、"settings"
let selectedDay = dateKey(new Date()); // 押して選んだ日（カレンダーの下に予定の一覧を出す）。最初は今日
let lastByDay = {};      // 最後に描いた、日付ごとの予定（選んだ日の一覧に使う）

// 表示している月（その月の1日）
const now = new Date();
let viewMonth = new Date(now.getFullYear(), now.getMonth(), 1);

// ===== 範囲の計算 =====

// カレンダーに表示する範囲：左上の月曜日〜右下の日曜日の次の日（週の始まりは月曜日）
function gridRange() {
  const offset = (viewMonth.getDay() + 6) % 7; // 1日が月曜日から何日目か（月曜 = 0、日曜 = 6）
  const start = new Date(viewMonth);
  start.setDate(1 - offset); // 1日がある週の月曜日まで戻る

  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((offset + daysInMonth) / 7); // 何週分の行が要るか

  const end = new Date(start);
  end.setDate(start.getDate() + weeks * 7);
  return { start, end, weeks };
}

// 予定を取ってくる範囲。次のどれもが入るように、一番早い日〜一番遅い日を取る
//  ・カレンダーの表示範囲
//  ・7か月前〜13か月後（集計の15か月分の表と、その平均・上限の計算に使う）
//  ・去年の10月〜今年の12月（年合計を出すため）
//  ・今日の年の前の年の9月〜再来年の2月（予定設定の24か月分と、その平均・上限の計算に使う）
function fetchRange() {
  const g = gridRange();
  const year = viewMonth.getFullYear();
  const todayYear = new Date().getFullYear();
  const start = new Date(Math.min(g.start, addMonths(viewMonth, -7), new Date(year - 1, 9, 1),
                                  new Date(todayYear - 1, 8, 1)));
  const end = new Date(Math.max(g.end, addMonths(viewMonth, 13), new Date(year + 1, 0, 1),
                                new Date(todayYear + 2, 2, 1)));
  return { start, end };
}

// ===== 選んだカレンダーの保存と読み込み =====

function loadSelected() {
  try {
    return JSON.parse(localStorage.getItem(SELECTED_KEY)) || [];
  } catch {
    return [];
  }
}

function saveSelected(ids) {
  localStorage.setItem(SELECTED_KEY, JSON.stringify(ids));
}

// ===== 左：カレンダーのチェックボックス =====
function renderCalendarChoices() {
  const selected = loadSelected();
  calendarSelect.textContent = "";

  for (const cal of calendars) {
    const label = el("label");
    const checkbox = el("input");
    checkbox.type = "checkbox";
    checkbox.value = cal.id;
    checkbox.checked = selected.includes(cal.id);
    checkbox.style.accentColor = cal.backgroundColor; // Google カレンダーと同じ色にする
    checkbox.onchange = onSelectionChange;

    label.append(checkbox, cal.summary);
    calendarSelect.appendChild(label);
  }
}

function onSelectionChange() {
  const checked = calendarSelect.querySelectorAll("input:checked");
  const ids = Array.from(checked).map(cb => cb.value);
  saveSelected(ids);
  loadMonth();
}

// ===== 真ん中：月のカレンダー =====

// 予定を日付ごとに分ける → { "2026-11-08": [予定, 予定], ... }
function groupByDay(list) {
  const byDay = {};
  const add = (key, item) => {
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(item);
  };

  for (const item of list) {
    const ev = item.event;
    if (ev.start.date) {
      // 終日の予定：開始日から終了日の前日まで、毎日に入れる
      const d = parseDate(ev.start.date);
      const end = parseDate(ev.end.date);
      while (d < end) {
        add(dateKey(d), item);
        d.setDate(d.getDate() + 1);
      }
    } else {
      // 時間つきの予定：開始した日に入れる
      add(dateKey(new Date(ev.start.dateTime)), item);
    }
  }
  return byDay;
}

// 予定の開始・終了を "11/08 17:00-22:00" のような文字にする
function formatEvent(event) {
  if (event.start.date) {
    return `${event.start.date.slice(5).replace("-", "/")} 終日`;
  }
  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);
  const day = `${start.getMonth() + 1}/${start.getDate()}`;
  const time = (d) => d.toTimeString().slice(0, 5);
  return `${day} ${time(start)}-${time(end)}`;
}

// 仮シフト1件分の表示（点線の枠）。押すと仮シフトの画面が開く
function makeTentativeChip(item) {
  const { event, tentative, shift } = item;
  const past = isPastTentative(tentative);
  const chip = el("button", `chip timed tentative${past ? " past" : ""}`);
  chip.type = "button";
  // カレンダーにはバイト先の名前だけ出す（時間はマウスを乗せたときと、下の一覧に出る）
  chip.append(el("span", "text", event.summary));
  chip.title = `仮シフト ${formatEvent(event)}  ${event.summary}` +
    (shift ? `  ${formatYen(shift.pay)}` : "") +
    (past ? "（日付が過ぎました。働いたとして数えています。シフトとして追加か削除をしてください）" : "");
  chip.onclick = (e) => {
    if (isNarrow()) return; // スマホでは日付のマスを押したのと同じ（下の一覧から開く）
    e.stopPropagation();
    openTentative(tentative);
  };
  return chip;
}

// スマホの幅か（予定の文字が小さいので、予定を押しても日付を選ぶだけにする）
function isNarrow() {
  return window.matchMedia("(max-width: 700px)").matches;
}

// 予定1件分の表示を作る
function makeChip(item) {
  if (item.tentative) return makeTentativeChip(item);
  const { event, cal, shift } = item; // item.event などを短い名前で取り出す
  const title = event.summary || "（タイトルなし）";

  // 予定の色は、どのカレンダーの予定も同じ青（仮シフトは点線の枠で見分ける）
  if (event.start.date) {
    // 終日
    const chip = el("div", "chip");
    chip.append(el("span", "text", title));
    chip.title = title;
    return chip;
  }

  // 時間つき：名前だけを出す（時間はマウスを乗せたときと、下の一覧に出る）。押すと詳細画面が開く
  const chip = el("button", "chip timed");
  chip.type = "button";
  if (shift) chip.classList.add("shift");

  // バイトのシフトは、予定名ではなくバイト先の名前（と役職）を出す（勤怠設定で名前を変えるとここも変わる）
  // 予定名は、マウスを乗せたときと、予定を押した画面の見出しに出る
  const shownTitle = shift ? [shift.place, shift.role].filter(Boolean).join(" ") : title;
  chip.append(el("span", "text", shownTitle));
  if (shift && shift.bonus) chip.append(el("span", "bonus-mark", "＋"));

  // マウスを乗せると全文（シフトなら給料も）が出る
  chip.title = `${formatEvent(event)}  ${title}` + (shift ? `  ${formatYen(shift.pay)}` : "");
  chip.onclick = (e) => {
    if (isNarrow()) return; // スマホでは日付のマスを押したのと同じ（下の一覧から開く）
    e.stopPropagation(); // 下にある日付のマスまで反応しないようにする
    openShiftDialog(item, renderAll, loadMonth); // 予定を削除・日時を変えたら予定を取り直す
  };
  return chip;
}

// ===== 長押しと、指を滑らせる操作 =====
// 長押しや指を滑らせたあと、指を離したときの「押した」は無視する（追加の画面がすぐ閉じたりしないように）
let swallowClick = false;
document.addEventListener("pointerdown", () => { swallowClick = false; }, true);
document.addEventListener("click", (e) => {
  if (!swallowClick) return;
  swallowClick = false;
  e.stopPropagation();
  e.preventDefault();
}, true);

// 日付のマスを長押ししたら onLongPress（0.5秒）
const LONG_PRESS_MS = 500;
function onLongPress(cell, onLongPress) {
  let timer = null;
  let startX = 0;
  let startY = 0;
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    cell.classList.remove("pressing");
  };
  cell.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    cell.classList.add("pressing");
    timer = setTimeout(() => {
      cancel();
      swallowClick = true;
      if (navigator.vibrate) navigator.vibrate(15);
      onLongPress();
    }, LONG_PRESS_MS);
  });
  cell.addEventListener("pointermove", (e) => {
    if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > 10) cancel(); // 指が動いたら長押しではない
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) cell.addEventListener(type, cancel);
  cell.addEventListener("contextmenu", (e) => e.preventDefault()); // スマホの長押しのメニューを出さない
}

// カレンダーを左右に指で滑らせたら月を替える（左へ滑らせると次の月）
let swipeStart = null;
grid.addEventListener("pointerdown", (e) => {
  swipeStart = e.pointerType === "mouse" ? null : { x: e.clientX, y: e.clientY };
});
grid.addEventListener("pointerup", (e) => {
  if (!swipeStart) return;
  const dx = e.clientX - swipeStart.x;
  const dy = e.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return; // 短い・縦向きなら月は替えない
  swallowClick = true;
  moveMonth(dx < 0 ? 1 : -1, dx < 0 ? "slide-left" : "slide-right");
});
grid.addEventListener("pointercancel", () => { swipeStart = null; });

// マス目を作る。byDay：日付ごとの予定
function renderGrid(byDay) {
  const { start, weeks } = gridRange();
  monthLabel.textContent = `${viewMonth.getFullYear()}年${viewMonth.getMonth() + 1}月`;
  // 全体の高さは CSS で決めてあるので、週の数（5か6）で割る。予定が多くても行は広がらない
  grid.style.gridTemplateRows = `repeat(${weeks}, minmax(0, 1fr))`;
  grid.textContent = "";

  const todayKey = dateKey(new Date());
  const d = new Date(start);

  for (let i = 0; i < weeks * 7; i++) {
    const key = dateKey(d);
    const cell = el("div", "day");
    if (d.getMonth() !== viewMonth.getMonth()) cell.classList.add("other-month");
    if (key === todayKey) cell.classList.add("today");
    if (key === selectedDay) cell.classList.add("selected");
    if (d.getDay() === 6) cell.classList.add("sat");
    if (d.getDay() === 0) cell.classList.add("sun");
    if (isHoliday(key)) cell.classList.add("holiday");
    cell.onclick = () => selectDay(key); // 押すと、カレンダーの下にその日の予定の一覧を出す
    onLongPress(cell, () => openAddShift(key)); // 長押しでシフト追加
    cell.title = "押すとこの日の予定の一覧、長押しでシフトを追加";

    cell.appendChild(el("div", "day-number", String(d.getDate())));

    for (const item of byDay[key] || []) {
      cell.appendChild(makeChip(item));
    }

    grid.appendChild(cell);
    d.setDate(d.getDate() + 1);
  }
}

// 日付のマスを押したとき：その日を選んで、カレンダーの下に予定の一覧を出す
function selectDay(key) {
  selectedDay = key;
  for (const cell of grid.querySelectorAll(".day.selected")) cell.classList.remove("selected");
  const cells = grid.querySelectorAll(".day");
  const { start } = gridRange();
  const index = Math.round((parseDate(key) - start) / 86400000); // 左上から何日目か
  if (cells[index]) cells[index].classList.add("selected");
  renderDayList();
  // 一覧が画面の外にあるときは、見えるところまで動かす
  dayListView.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// 選んだ日の予定の一覧。シフト・仮シフトを押すと直す画面が開く
function renderDayList() {
  dayListView.textContent = "";
  if (!selectedDay) {
    dayListView.append(el("p", "muted small", "日付を押すと、その日の予定がここに出ます。長押しするとシフトを追加できます。"));
    return;
  }
  const date = parseDate(selectedDay);
  const head = el("div", "tentative-head");
  const addButton = el("button", "", "＋ シフト");
  addButton.onclick = () => openAddShift(selectedDay);
  head.append(el("h3", "", `${date.getMonth() + 1}月${date.getDate()}日（${WEEKDAYS[date.getDay()]}）の予定`), addButton);
  dayListView.append(head);

  const list = lastByDay[selectedDay] || [];
  if (list.length === 0) {
    dayListView.append(el("p", "muted small", "予定はありません。日付を長押しするか「＋ シフト」で追加できます。"));
    return;
  }
  const hhmm = (d) => d.toTimeString().slice(0, 5);
  for (const item of list) {
    const { event, shift, tentative } = item;
    const allDay = !!event.start.date;
    const row = el(allDay ? "div" : "button",
      `day-row${tentative ? " tentative-item" : shift ? " shift" : ""}${tentative && isPastTentative(tentative) ? " past" : ""}`);
    const time = allDay ? "終日" : `${hhmm(new Date(event.start.dateTime))}〜${hhmm(new Date(event.end.dateTime))}`;
    const name = shift
      ? [shift.place, shift.role].filter(Boolean).join(" ")
      : event.summary || "（タイトルなし）";
    let amount = "";
    if (shift) amount = formatYen(shift.pay) + (tentative && isPastTentative(tentative) ? "（働いた扱い）" : "");
    row.append(
      el("span", "tentative-when", tentative ? `仮 ${time}` : time),
      el("span", "tentative-what", name),
      el("span", "value", amount),
    );
    if (!allDay) {
      row.type = "button";
      row.onclick = () => (tentative ? openTentative(tentative) : openShiftDialog(item, renderAll, loadMonth));
    }
    dayListView.append(row);
  }
}

// 自動確定をしてよい最初の月
//   その月の収入になるシフトを全部読み込めている月から
//   （翌々月払いもあるので、読み込んだ期間の始まりから3か月あとの月から）
//   最後の月はバイト先の支払いのしくみで決まる（income.js の lastClosedMonth）
function autoConfirmFirstMonth() {
  return monthKey(addMonths(new Date(loadedStart.getFullYear(), loadedStart.getMonth(), 1), 3));
}

// ===== 全体を描き直す（予定は取り直さない） =====
// バイト先や上限を変えたときもこれを呼ぶ
function renderAll() {
  const workplaces = loadWorkplaces();
  const edits = loadEdits(); // 詳細画面で入力した、予定ごとの設定
  const shifts = [];
  const dailyPaid = new Set(); // 日給をもう数えた「バイト先|日付」の組
  let unmatched = 0;

  for (const item of items) {
    const edit = edits[editKey(item)] || {};
    item.shift = eventToShift(item.event, workplaces, edit);
    if (item.shift) {
      // 日給は、同じバイト先・同じ日に予定が2つあっても1日分だけ数える（ボーナスは別）
      if (item.shift.payType === "daily") {
        const key = `${item.shift.place}|${item.shift.day}`;
        if (dailyPaid.has(key)) {
          item.shift.basePay = 0;
          item.shift.pay = item.shift.allowance + item.shift.transport + item.shift.bonus;
        }
        dailyPaid.add(key);
      }
      shifts.push(item.shift);
    } else if (edit.place !== "none" && item.event.start.dateTime &&
               monthKey(new Date(item.event.start.dateTime)) === monthKey(viewMonth)) {
      unmatched++; // 表示中の月の、どのバイト先にも当てはまらない時間つきの予定
    }
  }

  // 仮シフト：日付が過ぎていないものだけ数える（日給は、カレンダーのシフトと同じ日なら1日分だけ）
  // 同じ日・同じバイト先・時間が重なるシフトがもうカレンダーにある仮シフトは、シフトになったので消す
  // （予定を読み込めたときだけ。別の端末で Google カレンダーに入れたときなども、ここで消える）
  let tentatives = loadTentatives();
  if (loadedStart) {
    const done = tentativesInCalendar(tentatives, items.filter(x => x.shift), workplaces);
    if (done.length > 0) {
      for (const t of done) removeTentative(t.id);
      tentatives = loadTentatives();
    }
  }
  const tentativeItems = []; // カレンダーの表に出す分（過ぎたものは薄い赤で出す）
  const countedTentatives = []; // 数える仮シフトのシフト（回数で決めたものは回数分）
  const activeTentatives = []; // 右のパネルの内訳に出す分 [{ t, shift, count }]
  for (const t of tentatives) {
    if (isCountTentative(t)) {
      // 回数で決めたもの：日付がないのでカレンダーの表には出さない。
      // 仮の日付で回数分のシフトを作り、振り込まれる月ごとにまとめて内訳に出す
      //（仮の日付なので、日給の「同じ日は1日分」の判定はしない）
      const list = tentativeShifts(t, workplaces);
      countedTentatives.push(...list);
      const byPayMonth = {};
      for (const s of list) {
        const key = s.payDate.slice(0, 7);
        const g = byPayMonth[key] || (byPayMonth[key] = { ...s, pay: 0, workMin: 0, count: 0 });
        g.pay += s.pay;
        g.workMin += s.workMin;
        g.count += 1;
        if (s.payDate > g.payDate) g.payDate = s.payDate; // 何回かに分けて振り込まれるときは最後の日
      }
      for (const g of Object.values(byPayMonth)) activeTentatives.push({ t, shift: g, count: g.count });
      continue;
    }
    const shift = tentativeToShift(t, workplaces);
    tentativeItems.push({ event: tentativeEvent(t), tentative: t, shift });
    if (!shift) continue; // 日付が過ぎたものも、働いたとして数える
    if (shift.payType === "daily") {
      const key = `${shift.place}|${shift.day}`;
      if (dailyPaid.has(key)) {
        shift.basePay = 0;
        shift.pay = shift.allowance + shift.transport + shift.bonus;
      }
      dailyPaid.add(key);
    }
    countedTentatives.push(shift);
    activeTentatives.push({ t, shift, count: 1 });
  }

  // 月ごとの収入（振り込まれる月で数える。確定額があれば確定額、なければカレンダー＋仮シフトの額）
  // 日付が過ぎた仮シフトも入れるので、もう締まった月（自動確定する月）の額にも入る（扶養を超えないよう多めに見る）
  const allShifts = [...shifts, ...countedTentatives];
  let income = incomeByMonth(allShifts, workplaces, loadConfirmed());

  // もう勤務が入らない収入の月は、カレンダーの額で自動確定する（シフトがなければ0円）
  // （予定を読み込めたときだけ。何か変わったら計算し直す）
  if (loadedStart && autoConfirmClosed(income, workplaces, autoConfirmFirstMonth())) {
    income = incomeByMonth(allShifts, workplaces, loadConfirmed());
  }
  // カレンダーのシフトだけの収入（「来月の収入（予定）」と、上限の「カレンダーから」に使う）
  const incomeCalendar = incomeByMonth(shifts, workplaces, loadConfirmed());

  // 集計や各画面に渡す材料をひとまとめにする
  const ctx = {
    income, incomeCalendar, plans: loadPlans(), activeTentatives,
    shifts, viewMonth, unmatched, workplaces, onChange: renderAll,
  };

  lastByDay = groupByDay([...items, ...tentativeItems]);
  renderGrid(lastByDay);
  renderDayList();
  renderTentatives(tentativeView, viewMonth, workplaces, openTentative, () => {
    // 今月か過ぎた月を見ているときは今日、先の月ならその月の1日（仮シフトは過去の日付に作れないため）
    const today = new Date();
    const day = dateKey(monthKey(viewMonth) <= monthKey(today) ? today : viewMonth);
    openAddDialog(day, [], loadMonth, { mode: "tentative", onSaved: renderAll });
  });
  renderSummary(summaryPanel, ctx);
  if (currentView === "confirm") renderConfirm(confirmView, income, viewMonth, workplaces, renderAll);
  if (currentView === "plan") renderPlan(planView, ctx, renderAll);
  if (currentView === "stats") renderStats(statsView, ctx);
}

// ===== シフトの追加 =====
// 書き込めるカレンダー（自分のもの）。ログインしていなければ空（仮シフトだけ保存できる）
function writableCalendars() {
  if (!isLoggedIn) return [];
  const canWrite = (cal) => cal.accessRole === "owner" || cal.accessRole === "writer";
  const selected = loadSelected();
  // チェックを入れたカレンダーのうち書き込めるもの。なければ書き込めるもの全部
  const targets = calendars.filter(cal => canWrite(cal) && selected.includes(cal.id));
  return targets.length > 0 ? targets : calendars.filter(canWrite);
}

// day: "2026-11-10"。Google カレンダーにシフトを追加する画面を開く（仮シフトは下の「＋ 仮シフト」から）
function openAddShift(day) {
  openAddDialog(day, writableCalendars(), loadMonth); // Google カレンダーに追加できたら予定を取り直す
}

// 仮シフトを押したとき：直す・削除・Google カレンダーに追加
function openTentative(t) {
  // 日付が未定の仮シフトは、その月の1日を仮の日付として渡す（未定をやめたときの初期値）
  const day = t.date || `${t.month}-01`;
  openAddDialog(day, writableCalendars(), loadMonth, { tentative: t, onSaved: renderAll });
}

// 上の「＋ シフト」ボタン：表示中の月が今月なら今日、違えばその月の1日
document.getElementById("add-shift").onclick = () => {
  const today = new Date();
  const day = monthKey(today) === monthKey(viewMonth) ? today : viewMonth;
  openAddShift(dateKey(day));
};

// ===== 画面の切り替え（表示・予定設定・収入確定・勤怠設定） =====
function showView(view) {
  currentView = view;

  // body に "view-settings" などの印を付けたり外したりする。見た目の切り替えは CSS が担当
  document.body.classList.toggle("view-settings", view === "settings");
  document.body.classList.toggle("view-confirm", view === "confirm");
  document.body.classList.toggle("view-plan", view === "plan");
  document.body.classList.toggle("view-stats", view === "stats");

  // 選んだメニューに色を付ける（data-view="..." の値で見分ける）
  for (const button of document.querySelectorAll(".menu-item")) {
    button.classList.toggle("active", button.dataset.view === view);
  }

  if (view === "settings") renderSettings(settingsView, renderAll);
  if (view === "confirm" || view === "plan" || view === "stats") renderAll();
}

for (const button of document.querySelectorAll(".menu-item")) {
  button.onclick = () => showView(button.dataset.view);
}

// ===== 予定を取ってくる =====
async function loadMonth() {
  if (!isLoggedIn) {
    items = [];
    loadedStart = null; // 予定を読み込めていないので、自動確定はしない
    renderAll();
    message.textContent = "「Google でログイン」を押すと予定が表示されます（スマホでは左上の ☰ の中にあります）。";
    return;
  }

  const selected = loadSelected();
  const targets = calendars.filter(cal => selected.includes(cal.id));
  if (targets.length === 0) {
    items = [];
    loadedStart = null; // カレンダーを選んでいないので、自動確定はしない
    renderAll();
    message.textContent = "左の一覧から、読み込むカレンダーにチェックを入れてください。";
    return;
  }

  const myCount = ++loadCount;
  // 「読み込み中」は出さない（月を替えたときは、手元の予定で先に描いてあるので）
  const { start, end } = fetchRange();

  try {
    // 選んだカレンダーの予定を全部集める（どのカレンダーの予定かも一緒に持っておく）
    const collected = [];
    for (const cal of targets) {
      const events = await fetchEvents(cal.id, start, end);
      for (const event of events) collected.push({ event, cal });
    }

    // 待っている間に別の月へ移動していたら、この結果は使わない
    if (myCount !== loadCount) return;

    // 開始時刻の順に並べる（終日の予定が先に来る）
    const startText = (item) => item.event.start.dateTime || item.event.start.date;
    collected.sort((a, b) => startText(a).localeCompare(startText(b)));

    items = collected;
    loadedStart = start;
    renderAll();
    message.textContent = "";
  } catch (err) {
    if (myCount === loadCount) message.textContent = err.message;
  }
}

// ===== 月の移動 =====
// slide：指で滑らせたときの動き（"slide-left" か "slide-right"）
function moveMonth(diff, slide = "") {
  viewMonth = addMonths(viewMonth, diff);
  // 選んだ日が表示する月になければ選び直す（今月なら今日、ほかの月は選ばない）
  if (!selectedDay || selectedDay.slice(0, 7) !== monthKey(viewMonth)) {
    selectedDay = monthKey(viewMonth) === monthKey(new Date()) ? dateKey(new Date()) : null;
  }
  renderAll();  // 手元の予定で先に描いてから
  loadMonth();  // 新しい範囲の予定を取り直す
  if (slide) {
    grid.classList.remove("slide-left", "slide-right");
    void grid.offsetWidth; // 動きを最初からやり直すため
    grid.classList.add(slide);
  }
}

document.getElementById("prev").onclick = () => moveMonth(-1);
document.getElementById("next").onclick = () => moveMonth(1);
document.getElementById("today").onclick = () => {
  viewMonth = addMonths(new Date(), 0);
  moveMonth(0);
};

// ===== ログインできたら呼ばれる =====
async function onLogin() {
  isLoggedIn = true;
  try {
    calendars = await fetchCalendars();

    // メインのカレンダーの ID は Gmail アドレスと同じなので、次回のログイン用に覚えておく
    const main = calendars.find(cal => cal.primary);
    if (main) rememberAccount(main.id);

    renderCalendarChoices();
    document.body.classList.add("logged-in"); // マイカレンダーが出たら「Google でログイン」を隠す
    loadMonth();
  } catch (err) {
    message.textContent = err.message;
  }
}

// ログインの有効期限が切れたとき：マイカレンダーを消して、「Google でログイン」をまた出す
onTokenLost = () => {
  isLoggedIn = false;
  calendars = [];
  calendarSelect.textContent = "ログインすると表示されます。";
  document.body.classList.remove("logged-in");
};

// ===== いつも最新のファイルで開くためのしくみ（sw.js）を登録する =====
// インターネット上（https）で開いたときだけ。パソコンの 127.0.0.1 などでは使わない
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// ===== 起動時 =====
document.getElementById("login").onclick = login;
document.getElementById("login-menu").onclick = () => {
  closeDrawer();
  login();
};

// ===== スマホのメニュー（左上の三本線で開く引き出し） =====
function openDrawer() {
  document.body.classList.add("drawer-open");
}
function closeDrawer() {
  document.body.classList.remove("drawer-open");
}
document.getElementById("menu-toggle").onclick = openDrawer;
document.getElementById("menu-close").onclick = closeDrawer;
document.getElementById("drawer-backdrop").onclick = closeDrawer;
// メニューの画面を選んだら閉じる（カレンダーのチェックは、続けて選べるように閉じない）
for (const button of document.querySelectorAll(".menu-item")) {
  button.addEventListener("click", closeDrawer);
}
showView("calendar");
loadMonth();      // ログイン前でも空のカレンダーと集計を表示
initGoogle(onLogin);
