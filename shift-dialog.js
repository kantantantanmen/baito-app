// ===== 予定を押したときの詳細画面 =====
// 予定ごとの設定（バイト先・休憩・ボーナス）はブラウザに保存する
// 形: { "カレンダーID|予定ID": { place, breakMin, bonus, bonusNote }, ... }

const EDITS_KEY = "baito-shift-edits";
const WEEKDAYS = "日月火水木金土";
const shiftDialog = document.getElementById("shift-dialog");

function loadEdits() {
  try {
    return JSON.parse(localStorage.getItem(EDITS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveEdits(edits) {
  localStorage.setItem(EDITS_KEY, JSON.stringify(edits));
}

// 予定を見分けるための名前（同じ予定なら毎回同じになる）
function editKey(item) {
  return `${item.cal.id}|${item.event.id}`;
}

// 日付 "2026-11-10" と時刻 "17:00"〜"22:00" → 予定の start / end（終わりが始まり以前なら次の日に終わる）
function eventTimes(day, startTime, endTime) {
  let endDay = day;
  if (endTime <= startTime) {
    const d = parseDate(day);
    d.setDate(d.getDate() + 1);
    endDay = dateKey(d);
  }
  return {
    start: { dateTime: new Date(`${day}T${startTime}:00`).toISOString() },
    end: { dateTime: new Date(`${endDay}T${endTime}:00`).toISOString() },
  };
}

// ===== シフトの画面で共通の部品（シフトの追加・編集、仮シフトの追加・編集で同じ形にする） =====
// 項目の順番：日付 → バイト先 → 役職 → 時間 → 休憩 → ボーナス → メモ → 計算結果 → ボタン
// ボタンの順番（左から）：シフトとして追加 → 更新 → 削除 → 閉じる

// 画面の見出し。開いたときに入力欄（日付など）ではなく見出しを選んでおく
// （日付の欄が選ばれると、スマホでは最初からカレンダーが出てしまうため）
function dialogHeading(text) {
  const h = el("h2", "dialog-title", text);
  h.tabIndex = -1;
  h.autofocus = true;
  return h;
}

// 計算結果の行（振込予定日は呼ぶ側で足す）
function shiftPreviewRows(preview, shift, totalLabel = "合計") {
  addRow(preview, "拘束時間", formatHours(shift.spanMin));
  addRow(preview, "休憩", formatHours(shift.breakMin));
  addRow(preview, "働く時間", formatHours(shift.workMin), "strong");
  if (shift.nightMin) addRow(preview, "うち夜間", formatHours(shift.nightMin));
  if (shift.overtimeMin) addRow(preview, "うち残業", formatHours(shift.overtimeMin));
  addRow(preview, shift.payType === "daily" ? "日給" : "給料", formatYen(shift.basePay));
  if (shift.allowance) addRow(preview, "手当", formatYen(shift.allowance));
  if (shift.transport) addRow(preview, "交通費", formatYen(shift.transport));
  if (shift.bonus) addRow(preview, "ボーナス", formatYen(shift.bonus));
  addRow(preview, totalLabel, formatYen(shift.pay), "total big");
}

// 詳細画面を開く。設定が変わったら onChange、予定を削除したり日時を変えたりしたら onReload を呼ぶ
function openShiftDialog(item, onChange, onReload = () => {}) {
  const key = editKey(item);
  const edit = loadEdits()[key] || {};
  const workplaces = loadWorkplaces();
  const original = item.event;
  const start = new Date(original.start.dateTime);
  const end = new Date(original.end.dateTime);
  const hhmm = (d) => d.toTimeString().slice(0, 5);
  // 自分のカレンダーの予定なら、日時を変えたり消したりできる
  const canWrite = item.cal.accessRole === "owner" || item.cal.accessRole === "writer";

  shiftDialog.textContent = "";
  const form = el("form", "dialog-body");
  form.method = "dialog"; // このフォームのボタンを押すと画面が閉じる

  // --- 見出し：予定名 ---
  form.append(dialogHeading(original.summary || "（タイトルなし）"));

  // --- 日付と時間（変えたら「更新」で Google カレンダーの予定も直す。書き込めないカレンダーは変えられない） ---
  const dayInput = el("input");
  dayInput.type = "date";
  dayInput.value = dateKey(start);
  const startInput = timeInput(hhmm(start));
  const endInput = timeInput(hhmm(end));
  dayInput.disabled = startInput.disabled = endInput.disabled = !canWrite;
  const mainTimeField = field("時間", startInput, "〜", endInput);
  mainTimeField.classList.add("time-row");

  // 同じ日の2回目・3回目のシフト：「＋ 時間」で時間を足すと、「更新」で別の予定として Google カレンダーに入れる
  // （時給のバイト先で、書き込めるカレンダーの予定だけ）
  const extraTimes = []; // [{ start, end, row }]
  const extraBox = el("div");
  const addTimeButton = el("button", "add-time", "＋ 時間");
  addTimeButton.type = "button";
  const addTimeField = field("", addTimeButton);
  const renumberTimes = () => {
    mainTimeField.querySelector(".field-label").textContent = extraTimes.length > 0 ? "時間1" : "時間";
    extraTimes.forEach((x, i) => { x.row.querySelector(".field-label").textContent = `時間${i + 2}`; });
  };
  addTimeButton.onclick = () => {
    // シフト時間設定の時間でまだ入っていないものがあればそれ、なければ一番遅い時間の1時間後から2時間
    const current = [{ start: startInput.value, end: endInput.value },
      ...extraTimes.map(x => ({ start: x.start.value, end: x.end.value }))];
    const shiftNow = eventToShift(currentEvent(), workplaces, currentEdit());
    const defaults = shiftNow ? defaultTimesFor(shiftNow.place, dayInput.value || dateKey(start)) : [];
    const next = nextTimeRange(current, defaults);
    const s = timeInput(next.start);
    const e = timeInput(next.end);
    const del = el("button", "icon-btn remove-time", "×");
    del.type = "button";
    del.setAttribute("aria-label", "この時間を消す");
    const row = field("", s, "〜", e, del);
    row.classList.add("time-row");
    const x = { start: s, end: e, row };
    del.onclick = () => {
      extraTimes.splice(extraTimes.indexOf(x), 1);
      row.remove();
      renumberTimes();
      update();
    };
    s.oninput = update;
    e.oninput = update;
    extraTimes.push(x);
    extraBox.append(row);
    // 早い時間が時間1になるように並べ直す（時間1が変わったら、「更新」でこの予定の時間も直す）
    sortTimeInputs([{ start: startInput, end: endInput }, ...extraTimes]);
    renumberTimes();
    update();
  };
  form.append(field("日付", dayInput)); // 時間の欄は、バイト先・役職の下に置く（下で足す）
  // 日時が元の予定から変わったか
  const timeChanged = () => canWrite &&
    (dayInput.value !== dateKey(start) || startInput.value !== hhmm(start) || endInput.value !== hhmm(end));
  // 入力中の日時にした予定（計算に使う）。入力が空なら元の予定のまま
  const currentEvent = () => {
    if (!timeChanged() || !dayInput.value || !startInput.value || !endInput.value) return original;
    return { ...original, ...eventTimes(dayInput.value, startInput.value, endInput.value) };
  };

  // --- バイト先 ---
  const place = el("select");
  const auto = matchWorkplace(original, workplaces);
  place.append(option("", `自動（${auto ? auto.name : "当てはまるバイト先なし"}）`));
  for (const w of workplaces) {
    if (w.name) place.append(option(w.name, w.name));
  }
  place.append(option("none", "バイトではない"));
  place.value = edit.place || "";

  // --- 役職（選んでいるバイト先の役職から選ぶ） ---
  const role = el("select");
  const roleField = field("役職", role);
  const fillRoles = (selected) => {
    role.textContent = "";
    const wp = place.value && place.value !== "none"
      ? workplaces.find(w => w.name === place.value)
      : matchWorkplace(original, workplaces);
    const roles = wp ? (wp.roles || []).filter(r => r.name) : [];
    roleField.hidden = roles.length === 0; // 役職を登録していないバイト先なら欄を隠す
    if (roles.length === 0) return;

    const autoRole = findRole(original, wp, "");
    role.append(option("", `自動（${autoRole ? autoRole.name : "役職なし"}）`));
    for (const r of roles) role.append(option(r.name, r.name));
    role.append(option("-", "役職なし"));
    role.value = roles.some(r => r.name === selected) || selected === "-" ? selected : "";
  };
  fillRoles(edit.role || "");

  // --- 休憩・ボーナス ---
  const breakInput = numberInput(edit.breakMin ?? "", 0);
  breakInput.step = 5;
  const breakHint = el("span", "muted small");
  const bonus = numberInput(edit.bonus || "", 0);
  bonus.step = 100;
  bonus.placeholder = "0";
  const bonusNote = textInput(edit.bonusNote || "", "例：繁忙期手当、皆勤賞");

  const preview = el("div", "dialog-preview");

  form.append(
    field("バイト先", place),
    roleField,
    mainTimeField,
    extraBox,
    addTimeField,
    field("休憩", breakInput, "分", breakHint),
    field("ボーナス", bonus, "円"),
    field("メモ", bonusNote),
    preview,
  );

  // --- ボタン ---
  // 入力はすぐには保存しない。「更新」を押したら保存して、カレンダーと集計を計算し直す
  const close = el("button", "", "閉じる"); // 押すと、入力を保存せずに閉じる
  const save = el("button", "primary", "更新");
  save.type = "button";
  const deleteError = el("p", "warn");
  save.onclick = async () => {
    const changed = timeChanged();
    const extras = activeExtras();
    const p = extrasProblem();
    if (p) {
      deleteError.textContent = p;
      return;
    }
    if (changed) {
      if (!dayInput.value || !startInput.value || !endInput.value) {
        deleteError.textContent = "日付と時間を入れてください。";
        return;
      }
      // 日時が変わったら、Google カレンダーの予定を直す
      save.disabled = true;
      save.textContent = "更新中...";
      deleteError.textContent = "";
      try {
        const updated = await updateEvent(item.cal.id, original.id, eventTimes(dayInput.value, startInput.value, endInput.value));
        putEventLocally(item.cal, updated); // 読み直しを待たずに、カレンダーの表示を変える
      } catch (err) {
        deleteError.textContent = err.message;
        save.disabled = false;
        save.textContent = "更新";
        return;
      }
    }
    const e = currentEdit();
    const all = loadEdits();
    if (Object.keys(e).length > 0) all[key] = e;
    else delete all[key]; // 何も入力がなければ保存しておく必要がない
    saveEdits(all);

    // 足した時間：それぞれ別の予定として Google カレンダーに入れる（全部いっしょに送る。入れられた分は欄から消す）
    if (extras.length > 0) {
      save.disabled = true;
      save.textContent = "追加中...";
      const ex = extraEdit();
      const results = await Promise.allSettled([...extras].map(async (x) => {
        const made = await createEvent(item.cal.id, extraEvent(x));
        if (made && made.id && Object.keys(ex).length > 0) {
          const edits = loadEdits();
          edits[`${item.cal.id}|${made.id}`] = ex;
          saveEdits(edits);
        }
        putEventLocally(item.cal, made); // 読み直しを待たずに、カレンダーに出す
        extraTimes.splice(extraTimes.indexOf(x), 1);
        x.row.remove();
      }));
      const failed = results.find(r => r.status === "rejected");
      if (failed) {
        deleteError.textContent = failed.reason.message;
        save.disabled = false;
        save.textContent = "更新";
        renumberTimes();
        renderAll();
        return;
      }
    }
    shiftDialog.close();
    if (changed || extras.length > 0) {
      renderAll(); // 手元の予定で先に描き直す
      onReload();  // そのあと Google カレンダーから読み直す
    } else {
      onChange();
    }
  };
  const buttons = el("div", "dialog-buttons");
  buttons.append(save);

  // 予定そのものを Google カレンダーから消す（書き込めるカレンダーの予定だけ）
  if (canWrite) {
    const del = el("button", "danger", "削除");
    del.type = "button";
    del.onclick = async () => {
      del.disabled = true;
      del.textContent = "削除中...";
      deleteError.textContent = "";
      try {
        await deleteEvent(item.cal.id, original.id);
        const all = loadEdits();
        delete all[key]; // この予定用の入力も要らなくなる
        saveEdits(all);
        shiftDialog.close();
        removeEventLocally(item.cal.id, original.id);
        renderAll(); // 読み直しを待たずに消す
        onReload();
      } catch (err) {
        deleteError.textContent = err.message;
        del.disabled = false;
        del.textContent = "削除";
      }
    };
    buttons.append(del);
  }
  buttons.append(close);
  // 入力欄で Enter を押したときも「更新」と同じにする
  form.onsubmit = (submitEvent) => {
    submitEvent.preventDefault();
    save.onclick();
  };
  close.type = "button";
  close.onclick = () => shiftDialog.close();
  form.append(
    el("p", "muted small", canWrite
      ? "※ 日付や時間を変えて「更新」を押すと、Google カレンダーの予定も変わります。"
      : "※ このカレンダーは書き込めないので、日付と時間は Google カレンダーで直してください。"),
    deleteError,
    buttons,
  );

  // --- 足した時間 ---
  // 今使う足した時間（時給のバイトのシフトで、書き込めるカレンダーのときだけ）
  const canAddTime = () => {
    if (!canWrite) return false;
    const s = eventToShift(currentEvent(), workplaces, currentEdit());
    return !!s && s.payType !== "daily";
  };
  const activeExtras = () => (canAddTime() ? extraTimes : []);
  // 足した時間の予定（予定名は元の予定と同じ。日付は上の日付）
  const extraEvent = (x) => ({
    summary: original.summary,
    ...eventTimes(dayInput.value || dateKey(start), x.start.value, x.end.value),
  });
  // 足した時間の予定に付ける設定（バイト先・役職・休憩は同じ。ボーナス・メモは付けない）
  const extraEdit = () => {
    const e = currentEdit();
    delete e.bonus;
    delete e.bonusNote;
    return e;
  };
  // 足した時間の入れ忘れ・重なり（問題なければ ""）
  const extrasProblem = () => {
    const extras = activeExtras();
    if (extras.length === 0) return "";
    if (extras.some(x => !x.start.value || !x.end.value)) return "足した時間も入れてください。";
    const toMin = (v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
    const ranges = [[startInput.value, endInput.value], ...extras.map(x => [x.start.value, x.end.value])]
      .map(([s, e]) => ({ s: toMin(s), e: toMin(e) <= toMin(s) ? toMin(e) + 24 * 60 : toMin(e) }));
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        if (ranges[i].s < ranges[j].e && ranges[j].s < ranges[i].e) return "入れた時間どうしが重なっています。";
      }
    }
    return "";
  };

  // 計算結果の表示を作り直す
  const renderPreview = (e) => {
    let shift = eventToShift(currentEvent(), workplaces, e);
    preview.textContent = "";
    // 「＋ 時間」は時給のバイトのシフトのときだけ
    const allowAdd = canAddTime();
    addTimeField.hidden = !allowAdd;
    extraBox.hidden = !allowAdd;
    deleteError.textContent = extrasProblem();

    // 時間を足したときは、全部の時間を足し合わせた内訳と合計を1つだけ出す
    if (shift && allowAdd) {
      const ex = extraEdit();
      const extraShifts = extraTimes
        .filter(x => x.start.value && x.end.value)
        .map(x => eventToShift({ ...original, ...extraEvent(x) }, workplaces, ex))
        .filter(Boolean);
      if (extraShifts.length > 0) {
        shift = { ...shift };
        for (const s of extraShifts) {
          for (const k of ["spanMin", "breakMin", "workMin", "nightMin", "overtimeMin",
                           "basePay", "allowance", "transport", "bonus", "pay"]) {
            shift[k] = (shift[k] || 0) + (s[k] || 0);
          }
        }
      }
    }

    if (!shift) {
      breakInput.disabled = bonus.disabled = bonusNote.disabled = true;
      breakHint.textContent = "";
      preview.append(el("p", "muted", "バイトの予定として計算していません。バイトなら「バイト先」を選んでください。"));
      return;
    }
    breakInput.disabled = bonus.disabled = bonusNote.disabled = false;
    breakInput.placeholder = String(shift.autoBreak);
    breakHint.textContent = `空欄ならバイト先設定どおり（${formatHours(shift.autoBreak)}）`;

    shiftPreviewRows(preview, shift);
    addRow(preview, "振込予定日", shortDate(shift.payDate));
  };

  // 今の入力欄の中身
  function currentEdit() {
    const e = {};
    if (place.value) e.place = place.value;
    if (role.value && !roleField.hidden) e.role = role.value;
    if (breakInput.value !== "") e.breakMin = Number(breakInput.value);
    if (Number(bonus.value) > 0) e.bonus = Number(bonus.value);
    if (bonusNote.value.trim()) e.bonusNote = bonusNote.value.trim();
    return e;
  }

  // 入力が変わるたびに、この画面の計算だけ作り直す（保存は「更新」を押したとき）
  const update = () => renderPreview(currentEdit());
  place.onchange = () => {
    fillRoles(""); // バイト先が変わったら、役職の選択肢も入れ替える
    update();
  };
  role.onchange = update;
  for (const input of [breakInput, bonus, bonusNote, dayInput, startInput, endInput]) input.oninput = update;

  renderPreview(edit);
  shiftDialog.append(form);
  shiftDialog.showModal(); // 画面の上に重ねて表示する
}

// 画面の外（暗い部分）を押したら閉じる
shiftDialog.addEventListener("click", (e) => {
  if (e.target === shiftDialog) shiftDialog.close();
});
