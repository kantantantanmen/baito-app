// ===== シフトを追加する画面 =====
// 入力した内容で Google カレンダーに予定を作るか、仮シフトとして保存する。画面は詳細画面と同じ <dialog> を使う

// 前回の入力を覚えておく（次に追加するときの初期値にする）
// 形: { place: "カフェ", calendarId: "...", times: { "カフェ": { start: "17:00", end: "22:00" } } }
const LAST_SHIFT_KEY = "baito-last-shift";

function loadLastShift() {
  try {
    return JSON.parse(localStorage.getItem(LAST_SHIFT_KEY)) || { times: {} };
  } catch {
    return { times: {} };
  }
}

function saveLastShift(last) {
  localStorage.setItem(LAST_SHIFT_KEY, JSON.stringify(last));
}

// メッセージだけの画面（追加できないときに使う）
function showDialogMessage(title, text) {
  shiftDialog.textContent = "";
  const form = el("form", "dialog-body");
  form.method = "dialog";
  const buttons = el("div", "dialog-buttons");
  buttons.append(el("button", "primary", "閉じる"));
  form.append(el("h2", "dialog-title", title), el("p", "", text), buttons);
  shiftDialog.append(form);
  shiftDialog.showModal();
}

// day: "2026-11-10"、calendars: 書き込めるカレンダー（ログインしていなければ空）
// onAdded: Google カレンダーに追加できたら呼ぶ
// options.mode: "google"（Google カレンダーに追加する画面）か "tentative"（仮シフトを追加する画面）
// options.tentative: 開く仮シフト（押した仮シフトを直す・カレンダーに入れるとき。mode は "tentative" 扱い）
// options.onSaved: 仮シフトを保存・削除したら呼ぶ
function openAddDialog(day, calendars, onAdded, options = {}) {
  const tentative = options.tentative || null;
  const onSaved = options.onSaved || (() => {});
  const isTentativeMode = options.mode === "tentative" || !!tentative;
  const dialogTitle = tentative ? "仮シフト" : isTentativeMode ? "仮シフトを追加" : "シフトを追加";
  const workplaces = loadWorkplaces().filter(w => w.name);
  if (workplaces.length === 0) {
    showDialogMessage(dialogTitle, "先に「勤怠設定」でバイト先を登録してください。");
    return;
  }
  // Google カレンダーに追加する画面は、書き込めるカレンダーがないと使えない
  if (!isTentativeMode && calendars.length === 0) {
    showDialogMessage(dialogTitle,
      "Google にログインして、書き込めるカレンダーにチェックを入れると追加できます。" +
      "入るつもりのシフトは、カレンダーの下の「＋ 仮シフト」から仮シフトとして追加できます。");
    return;
  }

  const last = loadLastShift();
  if (!last.times) last.times = {};

  shiftDialog.textContent = "";
  const form = el("form", "dialog-body");
  form.method = "dialog";
  form.append(el("h2", "dialog-title", dialogTitle));

  // --- 入力欄 ---
  const date = el("input");
  date.type = "date";
  date.value = tentative ? tentative.date : day;

  let firstPlace = workplaces.some(w => w.name === last.place) ? last.place : workplaces[0].name;
  if (tentative && workplaces.some(w => w.name === tentative.place)) firstPlace = tentative.place;
  const place = selectInput(workplaces.map(w => [w.name, w.name]), firstPlace);

  // 役職（選んでいるバイト先に役職があるときだけ出す）
  const role = el("select");
  const roleField = field("役職", role);
  const fillRoles = () => {
    role.textContent = "";
    const wp = workplaces.find(w => w.name === place.value);
    const roles = wp ? (wp.roles || []).filter(r => r.name) : [];
    roleField.hidden = roles.length === 0;
    role.append(option("", "役職なし"));
    for (const r of roles) role.append(option(r.name, r.name));
    const lastRole = (last.roles || {})[place.value];
    if (roles.some(r => r.name === lastRole)) role.value = lastRole; // 前回の役職
  };
  fillRoles();
  if (tentative && tentative.role) role.value = tentative.role;

  const start = timeInput("");
  const end = timeInput("");
  // バイト先ごとに、前回の時間を初期値にする
  const setTimes = () => {
    const t = last.times[place.value] || { start: "17:00", end: "22:00" };
    start.value = t.start;
    end.value = t.end;
  };
  setTimes();
  if (tentative) {
    start.value = tentative.start;
    end.value = tentative.end;
  }

  // Google カレンダーに追加できるか
  //   ・シフトを追加する画面：できる（カレンダーがなければ上で止めている）
  //   ・仮シフトを追加する画面：できない（仮シフトとして保存するだけ）
  //   ・保存した仮シフトを押した画面：ログインしていればできる（入れたら仮シフトは消える）
  const canAddToGoogle = calendars.length > 0 && (!isTentativeMode || !!tentative);
  let calendar = null;
  let calendarField = el("span"); // カレンダーを選ばないときは空
  if (canAddToGoogle) {
    const firstCal = calendars.some(c => c.id === last.calendarId) ? last.calendarId : calendars[0].id;
    calendar = selectInput(calendars.map(c => [c.id, c.summary]), firstCal);
    calendarField = field("カレンダー", calendar);
  }

  const preview = el("div", "dialog-preview");
  const error = el("p", "warn");

  form.append(
    field("日付", date),
    field("バイト先", place),
    roleField,
    field("時間", start, "〜", end),
    calendarField,
    preview,
    error,
  );
  if (isTentativeMode) {
    form.append(el("p", "muted small",
      "仮シフト：まだ決まっていない、入るつもりのシフトです。このアプリの中だけに保存して、" +
      "「来月の収入（予定）」以外の計算に入ります。"));
  }

  // --- ボタン ---
  const cancel = el("button", "", "やめる");
  cancel.type = "button";
  cancel.onclick = () => shiftDialog.close();
  const add = el("button", "primary", "Google カレンダーに追加");
  add.type = "button";
  add.hidden = !canAddToGoogle;
  const saveTentative = el("button", canAddToGoogle ? "" : "primary", tentative ? "仮シフトを更新" : "仮シフトを追加");
  saveTentative.type = "button";
  const tentativeAllowed = isTentativeMode; // シフトを追加する画面では仮シフトにしない
  const buttons = el("div", "dialog-buttons");
  if (tentative) {
    const del = el("button", "danger", "削除");
    del.type = "button";
    del.onclick = () => {
      removeTentative(tentative.id);
      shiftDialog.close();
      onSaved();
    };
    buttons.append(del);
  }
  buttons.append(cancel, saveTentative, add);
  form.append(buttons);

  // 入力内容から、Google カレンダーに送る予定を作る
  const buildEvent = () => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone; // 例 "Asia/Tokyo"
    let endDay = date.value;
    if (end.value <= start.value) {
      // 終わりが始まりより前なら、次の日に終わる（夜勤など）
      const d = parseDate(date.value);
      d.setDate(d.getDate() + 1);
      endDay = dateKey(d);
    }
    return {
      // 予定名は「バイト先 役職」。役職名が入っていれば、あとで自動でその役職として計算される
      summary: role.value ? `${place.value} ${role.value}` : place.value,
      start: { dateTime: `${date.value}T${start.value}:00`, timeZone },
      end: { dateTime: `${endDay}T${end.value}:00`, timeZone },
    };
  };

  // 働く時間と給料の見込みを表示する
  const update = () => {
    preview.textContent = "";
    error.textContent = "";
    // 過ぎた日付は仮シフトにできない（Google カレンダーへの追加と、仮シフトの削除はできる）
    const past = date.value && date.value < dateKey(new Date());
    saveTentative.hidden = !tentativeAllowed || past;
    if (tentativeAllowed && past) {
      error.textContent = canAddToGoogle
        ? "過ぎた日付は仮シフトにできません。Google カレンダーには追加できます。"
        : "過ぎた日付は仮シフトにできません。";
    }
    if (!date.value || !start.value || !end.value) return;

    const ev = buildEvent();
    // 計算用：時刻を、時差つきの形に直して eventToShift に渡す
    const forCalc = {
      summary: ev.summary,
      start: { dateTime: new Date(ev.start.dateTime).toISOString() },
      end: { dateTime: new Date(ev.end.dateTime).toISOString() },
    };
    const shift = eventToShift(forCalc, loadWorkplaces(), { place: place.value });
    if (!shift) return;
    addRow(preview, "時間", `${start.value}〜${end.value}${ev.end.dateTime.startsWith(date.value) ? "" : "（翌日）"}`);
    addRow(preview, "働く時間", `${formatHours(shift.workMin)}（休憩${formatHours(shift.breakMin)}）`);
    if (shift.allowance) addRow(preview, "役職の手当", formatYen(shift.allowance));
    if (shift.transport) addRow(preview, "交通費", formatYen(shift.transport));
    addRow(preview, "給料の見込み", formatYen(shift.pay), "total big");
  };
  place.onchange = () => {
    fillRoles();
    setTimes();
    update();
  };
  role.onchange = update;
  for (const input of [date, start, end]) input.oninput = update;

  // 次回の初期値として覚えておく
  const remember = () => {
    last.place = place.value;
    if (calendar) last.calendarId = calendar.value;
    last.times[place.value] = { start: start.value, end: end.value };
    last.roles = { ...(last.roles || {}), [place.value]: role.value }; // バイト先ごとの前回の役職
    saveLastShift(last);
  };

  // 追加ボタン（Google カレンダー）
  const submit = async () => {
    if (!date.value || !start.value || !end.value) {
      error.textContent = "日付と時間を入れてください。";
      return;
    }
    add.disabled = true;
    add.textContent = "追加中...";
    try {
      await createEvent(calendar.value, buildEvent());
      // 仮シフトから入れたなら、仮シフトは消す（二重に数えないため）
      if (tentative) removeTentative(tentative.id);
      remember();
      shiftDialog.close();
      onAdded();
    } catch (err) {
      error.textContent = err.message;
      add.disabled = false;
      add.textContent = "Google カレンダーに追加";
    }
  };
  add.onclick = submit;

  // 仮シフトとして保存するボタン
  saveTentative.onclick = () => {
    if (!date.value || !start.value || !end.value) {
      error.textContent = "日付と時間を入れてください。";
      return;
    }
    if (!tentativeAllowed || date.value < dateKey(new Date())) return; // 過ぎた日付は保存しない（Enter で押されたとき用）
    upsertTentative({
      id: tentative ? tentative.id : undefined,
      date: date.value, place: place.value, role: role.value,
      start: start.value, end: end.value,
    });
    remember();
    shiftDialog.close();
    onSaved();
  };

  // 入力欄で Enter を押したとき：仮シフトの画面は仮シフトに保存、シフトを追加する画面は Google に追加
  form.onsubmit = (e) => {
    e.preventDefault();
    if (tentativeAllowed) saveTentative.onclick();
    else submit();
  };

  update();
  shiftDialog.append(form);
  shiftDialog.showModal();
}
