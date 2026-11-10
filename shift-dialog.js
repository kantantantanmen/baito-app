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

// 詳細画面を開く。設定が変わったら onChange、予定を削除したら onDeleted を呼ぶ
function openShiftDialog(item, onChange, onDeleted = () => {}) {
  const key = editKey(item);
  const edit = loadEdits()[key] || {};
  const workplaces = loadWorkplaces();
  const ev = item.event;
  const start = new Date(ev.start.dateTime);
  const end = new Date(ev.end.dateTime);
  const hhmm = (d) => d.toTimeString().slice(0, 5);

  shiftDialog.textContent = "";
  const form = el("form", "dialog-body");
  form.method = "dialog"; // このフォームのボタンを押すと画面が閉じる

  // --- 見出し：予定名と日時 ---
  form.append(
    el("h2", "dialog-title", ev.summary || "（タイトルなし）"),
    el("p", "dialog-date",
      `${start.getMonth() + 1}月${start.getDate()}日（${WEEKDAYS[start.getDay()]}） ${hhmm(start)}〜${hhmm(end)}`),
  );

  // --- バイト先 ---
  const place = el("select");
  const auto = matchWorkplace(ev, workplaces);
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
      : matchWorkplace(ev, workplaces);
    const roles = wp ? (wp.roles || []).filter(r => r.name) : [];
    roleField.hidden = roles.length === 0; // 役職を登録していないバイト先なら欄を隠す
    if (roles.length === 0) return;

    const autoRole = findRole(ev, wp, "");
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
    field("休憩", breakInput, "分", breakHint),
    field("ボーナス", bonus, "円"),
    field("メモ", bonusNote),
    preview,
  );

  // --- ボタン ---
  // 入力はすぐには保存しない。「更新」を押したら保存して、カレンダーと集計を計算し直す
  const close = el("button", "", "やめる"); // 押すと、入力を保存せずに閉じる
  const save = el("button", "primary", "更新");
  save.type = "button";
  save.onclick = () => {
    const e = currentEdit();
    const all = loadEdits();
    if (Object.keys(e).length > 0) all[key] = e;
    else delete all[key]; // 何も入力がなければ保存しておく必要がない
    saveEdits(all);
    shiftDialog.close();
    onChange();
  };
  const buttons = el("div", "dialog-buttons");

  // 予定そのものを Google カレンダーから消す（書き込めるカレンダーの予定だけ）
  const canDelete = item.cal.accessRole === "owner" || item.cal.accessRole === "writer";
  const deleteError = el("p", "warn");
  if (canDelete) {
    const del = el("button", "danger", "シフトを削除");
    del.type = "button";
    del.onclick = async () => {
      del.disabled = true;
      del.textContent = "削除中...";
      deleteError.textContent = "";
      try {
        await deleteEvent(item.cal.id, ev.id);
        const all = loadEdits();
        delete all[key]; // この予定用の入力も要らなくなる
        saveEdits(all);
        shiftDialog.close();
        onDeleted();
      } catch (err) {
        deleteError.textContent = err.message;
        del.disabled = false;
        del.textContent = "シフトを削除";
      }
    };
    buttons.append(del);
  }
  buttons.append(close, save);
  // 入力欄で Enter を押したときも「更新」と同じにする
  form.onsubmit = (submitEvent) => {
    submitEvent.preventDefault();
    save.onclick();
  };
  close.type = "button";
  close.onclick = () => shiftDialog.close();
  form.append(
    el("p", "muted small", "※ 時間を変えたいときは Google カレンダーで予定を直してください。"),
    deleteError,
    buttons,
  );

  // 計算結果の表示を作り直す
  const renderPreview = (e) => {
    const shift = eventToShift(ev, workplaces, e);
    preview.textContent = "";

    if (!shift) {
      breakInput.disabled = bonus.disabled = bonusNote.disabled = true;
      breakHint.textContent = "";
      preview.append(el("p", "muted", "バイトの予定として計算していません。バイトなら「バイト先」を選んでください。"));
      return;
    }
    breakInput.disabled = bonus.disabled = bonusNote.disabled = false;
    breakInput.placeholder = String(shift.autoBreak);
    breakHint.textContent = `空欄なら勤怠設定どおり（${formatHours(shift.autoBreak)}）`;

    addRow(preview, "拘束時間", formatHours(shift.spanMin));
    addRow(preview, "休憩", formatHours(shift.breakMin));
    addRow(preview, "働く時間", formatHours(shift.workMin), "strong");
    if (shift.role) addRow(preview, "役職", shift.role);
    if (shift.nightMin) addRow(preview, "うち夜間", formatHours(shift.nightMin));
    if (shift.overtimeMin) addRow(preview, "うち残業", formatHours(shift.overtimeMin));
    addRow(preview, shift.payType === "daily" ? "日給" : "給料", formatYen(shift.basePay));
    if (shift.allowance) addRow(preview, "役職の手当", formatYen(shift.allowance));
    if (shift.transport) addRow(preview, "交通費", formatYen(shift.transport));
    if (shift.bonus) addRow(preview, "ボーナス", formatYen(shift.bonus));
    addRow(preview, "合計", formatYen(shift.pay), "total big");
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
  for (const input of [breakInput, bonus, bonusNote]) input.oninput = update;

  renderPreview(edit);
  shiftDialog.append(form);
  shiftDialog.showModal(); // 画面の上に重ねて表示する
}

// 画面の外（暗い部分）を押したら閉じる
shiftDialog.addEventListener("click", (e) => {
  if (e.target === shiftDialog) shiftDialog.close();
});
