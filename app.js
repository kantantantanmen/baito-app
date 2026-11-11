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

const SELECTED_KEY = "baito-calendars"; // 選んだカレンダーの保存名

let calendars = [];      // ログイン後に取ってきたカレンダーの一覧
let items = [];          // 取ってきた予定 [{ event, cal, shift }, ...]
let loadedStart = null;  // items を取ってきた期間の始まり（読み込めていなければ null）
let isLoggedIn = false;
let loadCount = 0;       // 古い読み込み結果で上書きしないための番号
let currentView = "calendar"; // 今の画面："calendar"、"stats"、"plan"、"confirm"、"settings"

// 表示している月（その月の1日）
const now = new Date();
let viewMonth = new Date(now.getFullYear(), now.getMonth(), 1);

// ===== 範囲の計算 =====

// カレンダーに表示する範囲：左上の日曜日〜右下の土曜日の次の日
function gridRange() {
  const start = new Date(viewMonth);
  start.setDate(1 - viewMonth.getDay()); // 1日がある週の日曜日まで戻る

  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((viewMonth.getDay() + daysInMonth) / 7); // 何週分の行が要るか

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

// 予定の時間「17:00-22:00」の部品。スマホでは終わりの時間（-22:00）を隠して「17:00」だけにする
function chipTime(event, prefix = "") {
  const hhmm = (d) => d.toTimeString().slice(0, 5);
  const time = el("span", "text chip-time");
  if (prefix) time.append(el("span", "t-prefix", prefix)); // 「仮 」。スマホでは点線の枠で分かるので隠す
  time.append(hhmm(new Date(event.start.dateTime)), el("span", "t-end", `-${hhmm(new Date(event.end.dateTime))}`));
  return time;
}

// 仮シフト1件分の表示（点線の枠）。押すと仮シフトの画面が開く
function makeTentativeChip(item) {
  const { event, tentative, shift } = item;
  const past = isPastTentative(tentative);
  const chip = el("button", `chip timed tentative${past ? " past" : ""}`);
  chip.type = "button";
  const body = el("span", "chip-body");
  body.append(chipTime(event, "仮 "), el("span", "text", event.summary));
  chip.append(body);
  chip.title = `仮シフト ${formatEvent(event)}  ${event.summary}` +
    (past ? "（過ぎたので数えない）" : shift ? `  ${formatYen(shift.pay)}` : "");
  chip.onclick = (e) => {
    e.stopPropagation();
    openTentative(tentative);
  };
  return chip;
}

// 予定1件分の表示を作る
function makeChip(item) {
  if (item.tentative) return makeTentativeChip(item);
  const { event, cal, shift } = item; // item.event などを短い名前で取り出す
  const title = event.summary || "（タイトルなし）";

  if (event.start.date) {
    // 終日：色で塗りつぶす
    const chip = el("div", "chip");
    chip.style.background = cal.backgroundColor;
    chip.style.color = cal.foregroundColor;
    chip.append(el("span", "text", title));
    chip.title = title;
    return chip;
  }

  // 時間つき：色の点 + 「17:00-22:00」+ 予定名（2行）。押すと詳細画面が開く
  const chip = el("button", "chip timed");
  chip.type = "button";
  if (shift) chip.classList.add("shift");

  const dot = el("span", "dot");
  dot.style.background = cal.backgroundColor;

  const body = el("span", "chip-body");
  // バイトのシフトは、予定名ではなくバイト先の名前（と役職）を出す（勤怠設定で名前を変えるとここも変わる）
  // 予定名は、マウスを乗せたときと、予定を押した画面の見出しに出る
  const shownTitle = shift ? [shift.place, shift.role].filter(Boolean).join(" ") : title;
  body.append(chipTime(event), el("span", "text", shownTitle));
  chip.append(dot, body);
  if (shift && shift.bonus) chip.append(el("span", "bonus-mark", "＋"));

  // マウスを乗せると全文（シフトなら給料も）が出る
  chip.title = `${formatEvent(event)}  ${title}` + (shift ? `  ${formatYen(shift.pay)}` : "");
  chip.onclick = (e) => {
    e.stopPropagation(); // 下にある日付のマスの「シフト追加」まで反応しないようにする
    openShiftDialog(item, renderAll, loadMonth); // 予定を削除したら予定を取り直す
  };
  return chip;
}

// マス目を作る。byDay：日付ごとの予定
function renderGrid(byDay) {
  const { start, weeks } = gridRange();
  monthLabel.textContent = `${viewMonth.getFullYear()}年${viewMonth.getMonth() + 1}月`;
  grid.style.gridTemplateRows = `repeat(${weeks}, 1fr)`;
  grid.textContent = "";

  const todayKey = dateKey(new Date());
  const d = new Date(start);

  for (let i = 0; i < weeks * 7; i++) {
    const key = dateKey(d);
    const cell = el("div", "day");
    if (d.getMonth() !== viewMonth.getMonth()) cell.classList.add("other-month");
    if (key === todayKey) cell.classList.add("today");
    cell.onclick = () => openAddShift(key); // マスの空いているところを押すとシフト追加
    cell.title = "押すと Google カレンダーにシフトを追加";

    cell.appendChild(el("div", "day-number", String(d.getDate())));

    for (const item of byDay[key] || []) {
      cell.appendChild(makeChip(item));
    }

    grid.appendChild(cell);
    d.setDate(d.getDate() + 1);
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
  const tentatives = loadTentatives();
  const tentativeItems = []; // カレンダーの表に出す分（過ぎたものも薄く出す）
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
    if (!shift || isPastTentative(t)) continue;
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
  // 仮シフトは日付が過ぎていないものだけなので、もう締まった月（自動確定する月）には入らない
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

  renderGrid(groupByDay([...items, ...tentativeItems]));
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
  openAddDialog(t.date, writableCalendars(), loadMonth, { tentative: t, onSaved: renderAll });
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
  message.textContent = "読み込み中...";
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
function moveMonth(diff) {
  viewMonth = addMonths(viewMonth, diff);
  renderAll();  // 手元の予定で先に描いてから
  loadMonth();  // 新しい範囲の予定を取り直す
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
    loadMonth();
  } catch (err) {
    message.textContent = err.message;
  }
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
