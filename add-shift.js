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
  const today = dateKey(new Date());
  const thisMonth = monthKey(new Date());

  shiftDialog.textContent = "";
  const form = el("form", "dialog-body");
  form.method = "dialog";
  form.append(el("h2", "dialog-title", dialogTitle));

  // --- 入力欄 ---
  const date = el("input");
  date.type = "date";
  date.value = tentative && tentative.date ? tentative.date : day;

  // 日付は未定（仮シフトの画面だけ）：チェックすると、日付の代わりに「月」と「回数」を入れる
  // 日付の欄を空にしたときも、未定として扱う
  let kind = tentative && isCountTentative(tentative) ? "count" : "date";
  const undecided = el("input");
  undecided.type = "checkbox";
  undecided.checked = kind === "count";
  const undecidedLabel = el("label", "check");
  undecidedLabel.append(undecided, "未定");
  undecided.onchange = () => {
    kind = undecided.checked ? "count" : "date";
    if (kind === "date" && !date.value) date.value = day; // 未定をやめたら、日付を入れ直す
    showKind();
    update();
  };

  // 回数で決めるとき：働く月と回数
  const month = el("input");
  month.type = "month";
  month.min = thisMonth; // 過ぎた月には作れない
  month.value = tentative && tentative.month ? tentative.month : (day.slice(0, 7) < thisMonth ? thisMonth : day.slice(0, 7));
  const count = numberInput(tentative && tentative.count ? tentative.count : 4, 1);
  count.step = 1;

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

  // 休憩・ボーナス・メモ（仮シフトの画面だけ。予定を押した画面と同じ）
  const breakInput = numberInput(tentative && tentative.breakMin !== undefined ? tentative.breakMin : "", 0);
  breakInput.step = 5;
  const breakHint = el("span", "muted small");
  const bonus = numberInput(tentative && tentative.bonus ? tentative.bonus : "", 0);
  bonus.step = 100;
  bonus.placeholder = "0";
  const bonusNote = textInput(tentative && tentative.bonusNote ? tentative.bonusNote : "", "例：繁忙期手当、皆勤賞");

  // Google カレンダーに追加できるか
  //   ・シフトを追加する画面：できる（カレンダーがなければ上で止めている）
  //   ・仮シフトを追加する画面：できない（仮シフトとして保存するだけ）
  //   ・保存した仮シフト（日付で決めたもの）を押した画面：ログインしていればできる（入れたら仮シフトは消える）
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

  const dateField = isTentativeMode ? field("日付", date, undecidedLabel) : field("日付", date);
  const monthField = field("働く月", month);
  const countField = field("回数", count, "回");
  const countNote = el("p", "muted small",
    "日付が未定なので、その月の残りの日（今月なら今日から月末まで）に均等に割り振って計算します" +
    "（週払い・当日払いでも、振り込まれる月が決まるように）。日付が決まったら、押して日付を入れ直すか、回数を減らして日付つきの仮シフトを足してください。");
  const extraFields = [
    field("休憩", breakInput, "分", breakHint),
    field("ボーナス", bonus, "円（1回ごと）"),
    field("メモ", bonusNote),
  ];

  form.append(
    dateField,
    monthField,
    countField,
    field("バイト先", place),
    roleField,
    field("時間", start, "〜", end),
  );
  if (isTentativeMode) form.append(...extraFields);
  form.append(calendarField, countNote, preview, error);
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

  // 日付が決まっているか（未定か）に合わせて、出す欄とボタンを切り替える
  const showKind = () => {
    const isCount = isTentativeMode && kind === "count";
    date.disabled = isCount; // 未定のときは日付を入れない（欄は「未定」のチェックのために残す）
    if (isCount && date.value) month.value = date.value.slice(0, 7) < thisMonth ? thisMonth : date.value.slice(0, 7);
    monthField.hidden = !isCount;
    countField.hidden = !isCount;
    countNote.hidden = !isCount;
    calendarField.hidden = isCount; // 日にちがないので Google カレンダーには入れられない
    add.hidden = !canAddToGoogle || isCount;
  };

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

  // 今の入力から、保存する仮シフトの形を作る
  const draft = () => {
    const t = {
      id: tentative ? tentative.id : undefined,
      place: place.value, role: role.value, start: start.value, end: end.value,
    };
    if (kind === "count") {
      t.kind = "count";
      t.month = month.value;
      t.count = Math.max(1, Math.floor(Number(count.value) || 1));
    } else {
      t.date = date.value;
    }
    if (isTentativeMode) {
      if (breakInput.value !== "") t.breakMin = Number(breakInput.value);
      if (Number(bonus.value) > 0) t.bonus = Number(bonus.value);
      if (bonusNote.value.trim()) t.bonusNote = bonusNote.value.trim();
    }
    return t;
  };

  // 入力が足りないか、過ぎていて仮シフトにできないか（理由の文字。問題なければ ""）
  const problem = () => {
    if (!start.value || !end.value) return "時間を入れてください。";
    if (kind === "count" && isTentativeMode) {
      if (!month.value) return "働く月を入れてください。";
      if (month.value < thisMonth) return "過ぎた月は仮シフトにできません。";
      return "";
    }
    if (!date.value) return "日付を入れてください。";
    if (tentativeAllowed && date.value < today) {
      return canAddToGoogle
        ? "過ぎた日付は仮シフトにできません。Google カレンダーには追加できます。"
        : "過ぎた日付は仮シフトにできません。";
    }
    return "";
  };

  // 働く時間と給料の見込みを表示する
  const update = () => {
    preview.textContent = "";
    error.textContent = problem();
    const past = (kind === "count" && isTentativeMode)
      ? month.value && month.value < thisMonth
      : date.value && date.value < today;
    saveTentative.hidden = !tentativeAllowed || past;
    if (!start.value || !end.value) return;

    // 1回分の給料（回数で決めるときは、その月の1日として計算した目安）
    const t = draft();
    let shift;
    if (isTentativeMode) {
      if (kind === "count") {
        if (!month.value) return;
        shift = countSampleShift(t, loadWorkplaces());
      } else {
        if (!date.value) return;
        shift = tentativeToShift(t, loadWorkplaces());
      }
    } else {
      if (!date.value) return;
      const ev = buildEvent();
      // 計算用：時刻を、時差つきの形に直して eventToShift に渡す
      const forCalc = {
        summary: ev.summary,
        start: { dateTime: new Date(ev.start.dateTime).toISOString() },
        end: { dateTime: new Date(ev.end.dateTime).toISOString() },
      };
      shift = eventToShift(forCalc, loadWorkplaces(), { place: place.value });
    }
    if (!shift) return;

    breakInput.placeholder = String(shift.autoBreak);
    breakHint.textContent = `空欄なら勤怠設定どおり（${formatHours(shift.autoBreak)}）`;
    const nextDay = end.value <= start.value ? "（翌日）" : "";
    addRow(preview, "時間", `${start.value}〜${end.value}${nextDay}`);
    addRow(preview, "働く時間", `${formatHours(shift.workMin)}（休憩${formatHours(shift.breakMin)}）`);
    if (shift.nightMin) addRow(preview, "うち夜間", formatHours(shift.nightMin));
    if (shift.overtimeMin) addRow(preview, "うち残業", formatHours(shift.overtimeMin));
    if (shift.allowance) addRow(preview, "役職の手当", formatYen(shift.allowance));
    if (shift.transport) addRow(preview, "交通費", formatYen(shift.transport));
    if (shift.bonus) addRow(preview, "ボーナス", formatYen(shift.bonus));

    if (isTentativeMode && kind === "count") {
      addRow(preview, "1回の給料", formatYen(shift.pay));
      // 合計は、仮の日付で回数分を計算した額（週払い・当日払いは振り込まれる月も出す）
      const list = tentativeShifts(t, loadWorkplaces());
      addRow(preview, `合計（${list.length}回）`, formatYen(list.reduce((s, x) => s + x.pay, 0)), "total big");
      const byMonth = {};
      for (const s of list) {
        const m = s.payDate.slice(0, 7);
        byMonth[m] = (byMonth[m] || 0) + s.pay;
      }
      const months = Object.keys(byMonth).sort();
      if (months.length > 1) {
        for (const m of months) {
          addRow(preview, `　${monthName(parseDate(`${m}-01`))}に振り込まれる分`, formatYen(byMonth[m]));
        }
      } else if (months.length === 1) {
        addRow(preview, "振り込まれる月", monthName(parseDate(`${months[0]}-01`)));
      }
    } else {
      addRow(preview, "給料の見込み", formatYen(shift.pay), "total big");
      addRow(preview, "振込予定日", shortDate(shift.payDate));
    }
  };
  place.onchange = () => {
    fillRoles();
    setTimes();
    update();
  };
  role.onchange = update;
  for (const input of [date, month, count, start, end, breakInput, bonus, bonusNote]) input.oninput = update;
  // 仮シフトの画面で日付を空にしたら、「未定」にする
  date.oninput = () => {
    if (isTentativeMode && !date.value) {
      undecided.checked = true;
      kind = "count";
      showKind();
    }
    update();
  };

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
    const p = problem();
    if (!tentativeAllowed || p) {
      error.textContent = p;
      return;
    }
    upsertTentative(draft());
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

  showKind();
  update();
  shiftDialog.append(form);
  shiftDialog.showModal();
}
