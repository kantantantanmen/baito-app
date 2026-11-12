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
// 同じ日・同じバイト先のシフトが2つ以上あるときは、まとめて「時間1・時間2…」として出し、
// それぞれ直したり × で消したりできる（「＋ 時間」で足すと、「更新」で別の予定として入れる）
function openShiftDialog(item, onChange, onReload = () => {}) {
  const key = editKey(item);
  const edit = loadEdits()[key] || {};
  const workplaces = loadWorkplaces();
  const original = item.event;
  const start = new Date(original.start.dateTime);
  const hhmm = (d) => d.toTimeString().slice(0, 5);
  const isWritable = (x) => x.cal.accessRole === "owner" || x.cal.accessRole === "writer";
  // 自分のカレンダーの予定なら、日時を変えたり消したりできる
  const canWrite = isWritable(item);

  shiftDialog.textContent = "";
  const form = el("form", "dialog-body");
  form.method = "dialog"; // このフォームのボタンを押すと画面が閉じる

  // --- 見出し：予定名 ---
  form.append(dialogHeading(original.summary || "（タイトルなし）"));

  // --- 日付（変えたら「更新」で、ここに出ている時間の予定を全部その日に動かす） ---
  const dayInput = el("input");
  dayInput.type = "date";
  dayInput.value = dateKey(start);
  dayInput.disabled = !canWrite;
  form.append(field("日付", dayInput)); // 時間の欄は、バイト先・役職の下に置く（下で足す）

  // --- 時間 ---
  // 同じ日・同じバイト先（と役職）の、書き込めるカレンダーのシフト（開いた予定のほかに）
  const siblings = canWrite && item.shift ? items.filter(x => x !== item && x.shift && !x.event.start.date &&
    x.shift.day === item.shift.day && x.shift.place === item.shift.place && x.shift.role === item.shift.role &&
    isWritable(x)) : [];
  const timeRows = []; // [{ orig: 登録済みの予定（足した時間は null）, start, end, row, del }]
  const removed = [];  // × で消した、登録済みの予定
  const timeBox = el("div");
  const renumberTimes = () => {
    timeRows.forEach((r, i) => {
      r.row.querySelector(".field-label").textContent = timeRows.length > 1 ? `時間${i + 1}` : "時間";
      r.del.hidden = !canWrite || timeRows.length <= 1; // 1つだけのときは消せない（消すなら「削除」）
    });
  };
  const addRowFor = (orig, s0, e0) => {
    const s = timeInput(s0);
    const e = timeInput(e0);
    s.disabled = e.disabled = !canWrite;
    const del = el("button", "icon-btn remove-time", "×");
    del.type = "button";
    del.setAttribute("aria-label", "この時間を消す");
    const row = field("", s, "〜", e, del);
    row.classList.add("time-row");
    const r = { orig, start: s, end: e, row, del };
    del.onclick = () => {
      timeRows.splice(timeRows.indexOf(r), 1);
      if (orig) removed.push(orig);
      row.remove();
      renumberTimes();
      update();
    };
    s.oninput = () => update();
    e.oninput = () => update();
    timeRows.push(r);
    timeBox.append(row);
    return r;
  };
  // 登録済みの時間を、早い順に並べる
  const timeOf = (x) => [hhmm(new Date(x.event.start.dateTime)), hhmm(new Date(x.event.end.dateTime))];
  [item, ...siblings]
    .sort((a, b) => timeOf(a)[0].localeCompare(timeOf(b)[0]))
    .forEach(x => addRowFor(x, ...timeOf(x)));

  // 「＋ 時間」：シフト時間設定の時間でまだ入っていないものがあればそれ、なければ一番遅い時間の1時間後から2時間
  const addTimeButton = el("button", "add-time", "＋ 時間");
  addTimeButton.type = "button";
  const addTimeField = field("", addTimeButton);
  addTimeButton.onclick = () => {
    const current = timeRows.map(r => ({ start: r.start.value, end: r.end.value }));
    const base = baseShift();
    const defaults = base ? defaultTimesFor(base.place, dayInput.value || dateKey(start)) : [];
    const next = nextTimeRange(current, defaults);
    addRowFor(null, next.start, next.end);
    sortTimeInputs(timeRows); // 早い時間が時間1になるように並べ直す
    renumberTimes();
    update();
  };

  // その時間の行の予定（入力中の日付・時間にしたもの。入力が空なら元のまま）
  const day = () => dayInput.value || dateKey(start);
  const rowChanged = (r) => {
    if (!r.orig) return true;
    const [s0, e0] = timeOf(r.orig);
    return dayInput.value !== dateKey(new Date(r.orig.event.start.dateTime)) || r.start.value !== s0 || r.end.value !== e0;
  };
  const rowEvent = (r) => {
    const ev = r.orig ? r.orig.event : { summary: original.summary };
    if (!r.start.value || !r.end.value || !rowChanged(r)) return ev;
    return { ...ev, ...eventTimes(day(), r.start.value, r.end.value) };
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
    timeBox,
    addTimeField,
    field("休憩", breakInput, "分", breakHint),
    field("ボーナス", bonus, "円"),
    field("メモ", bonusNote),
    preview,
  );

  // 今の入力欄の中身（開いた予定の設定）
  function currentEdit() {
    const e = {};
    if (place.value) e.place = place.value;
    if (role.value && !roleField.hidden) e.role = role.value;
    if (breakInput.value !== "") e.breakMin = Number(breakInput.value);
    if (Number(bonus.value) > 0) e.bonus = Number(bonus.value);
    if (bonusNote.value.trim()) e.bonusNote = bonusNote.value.trim();
    return e;
  }
  // ほかの時間の予定に付ける設定：バイト先・役職・休憩はこの画面と同じ。ボーナス・メモは、その予定のものを残す
  const sharedEdit = (old = {}) => {
    const e = { ...old };
    delete e.place;
    delete e.role;
    delete e.breakMin;
    const c = currentEdit();
    for (const k of ["place", "role", "breakMin"]) if (k in c) e[k] = c[k];
    return e;
  };
  const editFor = (r) => {
    if (r.orig === item) return currentEdit();
    if (r.orig) return sharedEdit(loadEdits()[editKey(r.orig)] || {});
    return sharedEdit();
  };
  // 開いた予定を、今の入力で計算したもの（時給か・どのバイト先かを見るのに使う）
  const baseShift = () => eventToShift(original, workplaces, currentEdit());
  // 「＋ 時間」は、時給のバイトのシフトで、書き込めるカレンダーのときだけ
  const canAddTime = () => {
    const s = baseShift();
    return canWrite && !!s && s.payType !== "daily";
  };

  // 時間の入れ忘れ・重なり（問題なければ ""）
  const timesProblem = () => {
    if (timeRows.some(r => !r.start.value || !r.end.value)) return "時間を入れてください。";
    const toMin = (v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
    const ranges = timeRows.map(r => ({ s: toMin(r.start.value), e: toMin(r.end.value) }))
      .map(x => ({ s: x.s, e: x.e <= x.s ? x.e + 24 * 60 : x.e }));
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        if (ranges[i].s < ranges[j].e && ranges[j].s < ranges[i].e) return "入れた時間どうしが重なっています。";
      }
    }
    return "";
  };

  // --- ボタン ---
  // 入力はすぐには保存しない。「更新」を押したら保存して、カレンダーと集計を計算し直す
  const close = el("button", "", "閉じる"); // 押すと、入力を保存せずに閉じる
  const save = el("button", "primary", "更新");
  save.type = "button";
  const deleteError = el("p", "warn");

  // Google カレンダーへの書き込みを全部いっしょに送る。手元の予定もすぐ直す
  // 失敗したものがあっても、できた分は残して読み直す
  const finishWrites = async (tasks) => {
    const results = await Promise.allSettled(tasks.map(t => t()));
    const failed = results.find(r => r.status === "rejected");
    shiftDialog.close();
    renderAll(); // 手元の予定で先に描き直す
    onReload();  // そのあと Google カレンダーから読み直す
    if (failed) alert(`うまくいかなかったものがあります：${failed.reason.message}`);
  };

  save.onclick = async () => {
    const p = canWrite ? timesProblem() : "";
    if (p) {
      deleteError.textContent = p;
      return;
    }
    // 予定ごとの設定を保存する（開いた予定・ほかの時間の予定）
    const all = loadEdits();
    const putEdit = (k, e) => {
      if (Object.keys(e).length > 0) all[k] = e;
      else delete all[k]; // 何も入力がなければ保存しておく必要がない
    };
    if (!removed.includes(item)) putEdit(key, currentEdit());
    for (const r of timeRows) if (r.orig && r.orig !== item) putEdit(editKey(r.orig), editFor(r));
    saveEdits(all);

    // Google カレンダーに書き込むこと：時間・日付を変えた予定、足した時間、消した時間
    const tasks = [];
    for (const r of timeRows) {
      if (r.orig && rowChanged(r)) {
        tasks.push(async () => {
          const updated = await updateEvent(r.orig.cal.id, r.orig.event.id, eventTimes(day(), r.start.value, r.end.value));
          putEventLocally(r.orig.cal, updated);
        });
      } else if (!r.orig) {
        tasks.push(async () => {
          const made = await createEvent(item.cal.id, { summary: original.summary, ...eventTimes(day(), r.start.value, r.end.value) });
          const e = editFor(r);
          if (made && made.id && Object.keys(e).length > 0) {
            const edits = loadEdits();
            edits[`${item.cal.id}|${made.id}`] = e;
            saveEdits(edits);
          }
          putEventLocally(item.cal, made);
        });
      }
    }
    for (const x of removed) {
      tasks.push(async () => {
        await deleteEvent(x.cal.id, x.event.id);
        const edits = loadEdits();
        delete edits[editKey(x)];
        saveEdits(edits);
        removeEventLocally(x.cal.id, x.event.id);
      });
    }
    if (tasks.length === 0) {
      shiftDialog.close();
      onChange();
      return;
    }
    save.disabled = true;
    save.textContent = "更新中...";
    await finishWrites(tasks);
  };
  const buttons = el("div", "dialog-buttons");
  buttons.append(save);

  // 予定そのものを Google カレンダーから消す（ここに出ている時間の予定を全部。書き込めるカレンダーだけ）
  if (canWrite) {
    const del = el("button", "danger", "削除");
    del.type = "button";
    del.onclick = async () => {
      const targets = [item, ...siblings];
      if (targets.length > 1 && !confirm(`この日の${targets.length}つの時間を全部削除しますか？`)) return;
      del.disabled = true;
      del.textContent = "削除中...";
      await finishWrites(targets.map(x => async () => {
        await deleteEvent(x.cal.id, x.event.id);
        const edits = loadEdits();
        delete edits[editKey(x)]; // この予定用の入力も要らなくなる
        saveEdits(edits);
        removeEventLocally(x.cal.id, x.event.id);
      }));
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

  // 計算結果の表示を作り直す（時間が2つ以上なら、全部を足し合わせた内訳と合計を1つだけ出す）
  const renderPreview = () => {
    preview.textContent = "";
    addTimeField.hidden = !canAddTime();
    deleteError.textContent = canWrite ? timesProblem() : "";

    const shifts = timeRows.map(r => {
      const ev = rowEvent(r);
      return ev.start ? eventToShift(ev, workplaces, editFor(r)) : null; // 足した時間がまだ空なら数えない
    }).filter(Boolean);
    if (shifts.length === 0) {
      breakInput.disabled = bonus.disabled = bonusNote.disabled = true;
      breakHint.textContent = "";
      preview.append(el("p", "muted", "バイトの予定として計算していません。バイトなら「バイト先」を選んでください。"));
      return;
    }
    const shift = { ...shifts[0] };
    for (const s of shifts.slice(1)) {
      for (const k of ["spanMin", "breakMin", "workMin", "nightMin", "overtimeMin",
                       "basePay", "allowance", "transport", "bonus", "pay"]) {
        shift[k] = (shift[k] || 0) + (s[k] || 0);
      }
    }
    breakInput.disabled = bonus.disabled = bonusNote.disabled = false;
    breakInput.placeholder = String(shift.autoBreak);
    breakHint.textContent = `空欄ならバイト先設定どおり（${formatHours(shift.autoBreak)}）`;

    shiftPreviewRows(preview, shift);
    addRow(preview, "振込予定日", shortDate(shift.payDate));
  };

  // 入力が変わるたびに、この画面の計算だけ作り直す（保存は「更新」を押したとき）
  const update = () => renderPreview();
  place.onchange = () => {
    fillRoles(""); // バイト先が変わったら、役職の選択肢も入れ替える
    update();
  };
  role.onchange = update;
  for (const input of [breakInput, bonus, bonusNote, dayInput]) input.oninput = update;

  renumberTimes();
  renderPreview();
  shiftDialog.append(form);
  shiftDialog.showModal(); // 画面の上に重ねて表示する
}

// 画面の外（暗い部分）を押したら閉じる
shiftDialog.addEventListener("click", (e) => {
  if (e.target === shiftDialog) shiftDialog.close();
});
