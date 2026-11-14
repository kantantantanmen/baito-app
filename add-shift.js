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
// options.unit: 何回分かまとめた日付未定の仮シフトの、1回分だけを開くとき（回数の欄は出さない）
//   unit でないときに日付未定の仮シフトを開くと、まとめた全体（回数・時間など）を直す
// options.alsoTentative: シフトを追加する画面に「仮シフトとして追加」のボタンも出す（日付のマスを長押ししたとき）
// options.onSaved: 仮シフトを保存・削除したら呼ぶ
function openAddDialog(day, calendars, onAdded, options = {}) {
  const tentative = options.tentative || null;
  const onSaved = options.onSaved || (() => {});
  const isTentativeMode = options.mode === "tentative" || !!tentative;
  const alsoTentative = !isTentativeMode && !!options.alsoTentative;
  const groupCount = tentative && isCountTentative(tentative) ? Number(tentative.count) || 1 : 1;
  const isUnit = !!options.unit && groupCount > 1;   // まとめたものの1回分
  const isWholeGroup = !isUnit && groupCount > 1;    // まとめたもの全体
  const dialogTitle = tentative
    ? (isUnit ? `仮シフト（× ${groupCount}回のうち1回）` : isWholeGroup ? `仮シフト（× ${groupCount}回）` : "仮シフト")
    : isTentativeMode ? "仮シフトを追加" : "シフトを追加";
  const workplaces = loadWorkplaces().filter(w => w.name);
  if (workplaces.length === 0) {
    showDialogMessage(dialogTitle, "先に「バイト先設定」でバイト先を登録してください。");
    return;
  }
  // Google カレンダーに追加する画面は、書き込めるカレンダーがないと使えない（仮シフトとしても追加できる画面は開く）
  if (!isTentativeMode && !alsoTentative && calendars.length === 0) {
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
  form.append(dialogHeading(dialogTitle));

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
    // 未定をやめたら、日付を入れ直す（その月の1日が過ぎていれば今日。過ぎた日付は仮シフトにできないため）
    if (kind === "date") {
      const first = `${month.value || day.slice(0, 7)}-01`;
      if (!date.value || date.value < today) date.value = first < today ? today : first;
    }
    showKind();
    update();
  };

  // 日付が未定のとき：働く月だけ入れる（普通のシフトと同じ1回分）
  const month = el("input");
  month.type = "month";
  month.min = thisMonth; // 過ぎた月には作れない
  month.value = tentative && tentative.month ? tentative.month : (day.slice(0, 7) < thisMonth ? thisMonth : day.slice(0, 7));
  // 回数：同じ内容の日付未定の仮シフトを、何回分まとめて入れるか（「× 3 回」）
  // 保存した日付未定の仮シフトを開いたときは、その回数から始める（1回分を開いたときは回数の欄を出さない）
  const countInput = numberInput(tentative && isCountTentative(tentative) && !isUnit ? groupCount : 1, 1);
  countInput.step = 1;
  countInput.classList.add("count-input");
  const countValue = () => (isUnit ? 1 : Math.max(1, Math.floor(Number(countInput.value) || 1)));

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

  // 同じ日に2回目・3回目のシフトがあるとき：「＋ 時間」で時間の欄を足す（時給のバイト先で、日付が決まっているときだけ）
  // 足した時間は、それぞれ別のシフト（Google カレンダーの予定・仮シフト）として保存する
  const extraTimes = []; // [{ start, end, row }]
  const extraBox = el("div");
  const addTimeButton = el("button", "add-time", "＋ 時間");
  addTimeButton.type = "button";
  const addTimeField = field("", addTimeButton);
  // 消す × は、時間の右側に置く（時間が2つ以上あるときだけ。1つ目の時間にも付ける）
  const removeButton = () => {
    const b = el("button", "icon-btn remove-time", "×");
    b.type = "button";
    b.setAttribute("aria-label", "この時間を消す");
    return b;
  };
  const mainRemove = removeButton();
  const mainTimeField = field("時間", start, "〜", end, mainRemove);
  mainTimeField.classList.add("time-row");
  // 見出しを「時間」または「時間1・時間2…」にし、× を出すかどうかを決める
  const renumberTimes = () => {
    const many = extraTimes.length > 0 && !extraBox.hidden;
    mainTimeField.querySelector(".field-label").textContent = many ? "時間1" : "時間";
    mainRemove.hidden = !many;
    extraTimes.forEach((x, i) => {
      x.row.querySelector(".field-label").textContent = `時間${i + 2}`;
    });
  };
  // 1つ目の時間を消す：2つ目の時間を1つ目に繰り上げる
  mainRemove.onclick = () => {
    const next = extraTimes.shift();
    if (!next) return;
    start.value = next.start.value;
    end.value = next.end.value;
    next.row.remove();
    renumberTimes();
    update();
  };
  // 時間の欄を1つ足す。values があればその時間を入れる（なければ nextTimeRange で決める：
  // シフト時間設定の時間でまだ入っていないもの、なければ一番遅い時間の1時間後から2時間）
  const addTimeRow = (values) => {
    if (!values) {
      // この画面の時間に加えて、その日にもう入っているシフト・仮シフトの時間も「入っている」として数える
      const current = [...registeredTimes(), { start: start.value, end: end.value },
        ...extraTimes.map(x => ({ start: x.start.value, end: x.end.value }))];
      const defaults = isHourly() && kind === "date" ? defaultTimesFor(place.value, date.value) : [];
      values = nextTimeRange(current, defaults);
    }
    const s = timeInput(values.start);
    const e = timeInput(values.end);
    const remove = removeButton();
    const row = field("", s, "〜", e, remove);
    row.classList.add("time-row");
    const x = { start: s, end: e, row };
    remove.onclick = () => {
      extraTimes.splice(extraTimes.indexOf(x), 1);
      row.remove();
      renumberTimes();
      update();
    };
    s.oninput = update;
    e.oninput = update;
    extraTimes.push(x);
    extraBox.append(row);
    renumberTimes();
  };
  addTimeButton.onclick = () => {
    addTimeRow();
    // 早い時間が時間1になるように並べ直す
    sortTimeInputs([{ start, end }, ...extraTimes]);
    update();
  };
  // シフト時間設定で、このバイト先・この曜日の時間が決めてあれば入れる（時間1・時間2…）
  // 決めていなければ、前回そのバイト先で入れた時間（1つ目だけ）。開いた仮シフトを直すときは変えない
  // force：決めた時間がないときも前回の時間に戻す（バイト先を変えたとき）
  // その日にもうシフト・仮シフトが入っているときは、その時間を除く。
  // 決めた時間が全部もう入っていれば（または決めていなくても、その日にもうシフトがあれば）、
  // 一番遅いシフトの終わりの1時間後から2時間を入れる
  const registeredTimes = () => (kind === "date" ? existingTimesOn(place.value, date.value, tentative && tentative.id) : []);
  const applyDefaultTimes = (force) => {
    if (tentative) return;
    const hourly = isHourly() && kind === "date";
    const defaults = hourly ? defaultTimesFor(place.value, date.value) : [];
    const registered = hourly ? registeredTimes() : [];
    const same = (a, b) => a.start === b.start && a.end === b.end;
    const left = defaults.filter(d => !registered.some(r => same(r, d)));
    const clearExtras = () => { for (const x of extraTimes.splice(0)) x.row.remove(); };
    if (left.length > 0) {
      clearExtras();
      start.value = left[0].start;
      end.value = left[0].end;
      for (const t of left.slice(1)) addTimeRow(t);
    } else if (registered.length > 0) {
      const next = nextTimeRange(registered, []);
      if (next.start) {
        clearExtras();
        start.value = next.start;
        end.value = next.end;
      } else if (force) {
        clearExtras();
        setTimes();
      }
    } else if (force) {
      clearExtras();
      setTimes();
    }
    renumberTimes();
  };
  // 今使う足した時間（時給でないときや、日付が未定のときは使わない）
  const isHourly = () => {
    const wp = workplaces.find(w => w.name === place.value);
    return !wp || wp.payType !== "daily";
  };
  const activeExtras = () => (isHourly() && !(isTentativeMode && kind === "count")) ? extraTimes : [];

  // 休憩・ボーナス・メモ（予定を押した画面と同じ。Google カレンダーに追加したら、その予定の設定として残す）
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
  // Google カレンダーに入れるときは、チェックを入れた書き込めるカレンダー（前回入れたものがあればそれ）に入れる
  const canAddToGoogle = calendars.length > 0 && (!isTentativeMode || !!tentative);
  const calendarId = !canAddToGoogle ? null
    : calendars.some(c => c.id === last.calendarId) ? last.calendarId : calendars[0].id;

  const preview = el("div", "dialog-preview");
  const error = el("p", "warn");

  const dateField = isTentativeMode ? field("日付", date, undecidedLabel) : field("日付", date);
  const monthField = field("働く月", month);
  // 日付が未定で、働く日によって振り込まれる月が変わるとき（週払い・当日払い、月の途中で締めるなど）に選ぶ
  const payMonth = el("select");
  const payMonthField = field("振り込まれる月", payMonth);
  let chosenPayMonth = tentative && tentative.payMonth ? tentative.payMonth : "";
  payMonth.onchange = () => {
    chosenPayMonth = payMonth.value;
    update();
  };
  const countField = field("回数", "×", countInput, "回");
  const countNote = el("p", "muted small",
    "日付が決まったら「未定」を外して日付を入れてください。" +
    (tentative ? "「シフトとして追加」もできるようになります。" : ""));

  // 項目の順番は、予定を押した画面と同じ（日付 → バイト先 → 役職 → 時間 → 休憩 → ボーナス → メモ）
  form.append(
    dateField,
    monthField,
    countField,
    payMonthField,
    field("バイト先", place),
    roleField,
    mainTimeField,
    extraBox,
    addTimeField,
    field("休憩", breakInput, "分", breakHint),
    field("ボーナス", bonus, "円"),
    field("メモ", bonusNote),
    countNote,
    preview,
    error,
  );

  // --- ボタン（左から：シフトとして追加 → 更新 → 削除 → 閉じる） ---
  const cancel = el("button", "", "閉じる");
  cancel.type = "button";
  cancel.onclick = () => shiftDialog.close();
  const add = el("button", "primary", "シフトとして追加"); // Google カレンダーに予定を作る
  add.type = "button";
  const saveTentative = el("button", canAddToGoogle ? "" : "primary",
    tentative ? "更新" : alsoTentative ? "仮シフトとして追加" : "仮シフトを追加");
  saveTentative.type = "button";
  // シフトを追加する画面では仮シフトにしない（長押しで開いたときは「仮シフトとして追加」もできる）
  const tentativeAllowed = isTentativeMode || alsoTentative;
  const buttons = el("div", "dialog-buttons");
  buttons.append(add, saveTentative);
  if (tentative) {
    const del = el("button", "danger", "削除");
    del.type = "button";
    del.onclick = () => {
      // まとめたもの全体を開いたときは、全部消してよいか聞く
      if (isWholeGroup && !confirm(`× ${groupCount}回分をまとめて削除します。よろしいですか？`)) return;
      // 何回分かまとめたものの1回分なら、1回分だけ減らす
      if (splitFrom && restCount > 0) finishSplit();
      else removeTentative(tentative.id);
      shiftDialog.close();
      onSaved();
    };
    buttons.append(del);
  }
  buttons.append(cancel);
  // ボタンの文字を変える（長押しで開いた画面では、文字を小さくするための入れ物に入れる）
  const setLabel = (button, text) => {
    if (!alsoTentative) {
      button.textContent = text;
      return;
    }
    button.textContent = "";
    button.append(el("span", "btn-label", text));
  };
  if (alsoTentative) {
    // 「シフトとして追加・仮シフトとして追加・閉じる」は長いので、スマホではこの画面だけ文字を小さくする
    buttons.classList.add("compact");
    for (const b of [add, saveTentative, cancel]) setLabel(b, b.textContent);
  }

  // 日付未定の仮シフトを開いたとき：日付を入れると、その日の仮シフト（または予定）になる
  // 何回分かまとめたもの（× 3回 など）の1回分を開いたときは、その1回分だけを直す・日付を入れる・消す。残りはそのまま残る
  // まとめたもの全体を開いたときは、全体をそのまま直す（splitFrom なし）
  const splitFrom = tentative && isCountTentative(tentative) && !isWholeGroup ? tentative : null;
  const restCount = splitFrom ? Math.max(0, (Number(splitFrom.count) || 1) - 1) : 0;
  const splitNote = el("p", "note small");
  // 保存した仮シフトを開いたのに「Google カレンダーに追加」が出せないとき、その理由とやること
  //   ・日付が未定：「未定」を外して日付を入れる
  //   ・ログインしていない（通行証は1時間で切れる）：ログインしてから開き直す
  const googleHint = el("div", "google-hint");
  const loginButton = el("button", "", "Google でログイン");
  loginButton.type = "button";
  loginButton.onclick = () => {
    shiftDialog.close();
    login(); // ログインできたら予定を読み直す。そのあと、この仮シフトをもう一度押す
  };
  form.append(splitNote, googleHint, buttons);

  // 未定の仮シフトから1回分を取り出したあとの、元の仮シフトの片付け（残りの回数を減らす。0回なら消す）
  const finishSplit = () => {
    if (restCount > 0) upsertTentative({ ...splitFrom, count: restCount });
    else removeTentative(splitFrom.id);
  };

  // 日付が決まっているか（未定か）に合わせて、出す欄とボタンを切り替える
  const showKind = () => {
    const isCount = isTentativeMode && kind === "count";
    date.disabled = isCount; // 未定のときは日付を入れない（欄は「未定」のチェックのために残す）
    if (isCount && date.value) month.value = date.value.slice(0, 7) < thisMonth ? thisMonth : date.value.slice(0, 7);
    monthField.hidden = !isCount;
    countField.hidden = !isCount || isUnit;
    // まとめたもの全体を直すときは日付を入れない（日付を入れるのは1回ずつに分けてから）
    dateField.hidden = isWholeGroup;
    countNote.hidden = !isCount;
    // 「＋ 時間」は時給のバイト先で、日付が決まっているときだけ
    const canAddTime = isHourly() && !isCount;
    addTimeField.hidden = !canAddTime;
    extraBox.hidden = !canAddTime;
    renumberTimes();
    add.hidden = !canAddToGoogle || isCount; // 日にちがないので Google カレンダーには入れられない
    // 何回分かまとめたものの1回分を開いたとき：何をするかを書く
    splitNote.hidden = !(splitFrom && restCount > 0);
    if (splitFrom && restCount > 0) {
      const rest = `残りの${restCount}回は、${monthName(parseDate(`${splitFrom.month}-01`))}中・日付未定のまま残ります。`;
      splitNote.textContent = isCount
        ? `× ${splitFrom.count}回のうちの1回分を直します。${rest}`
        : `この日の1回分を、日付ありの仮シフト（または Google カレンダーの予定）にします。${rest}`;
    }

    googleHint.textContent = "";
    // （日付が未定のときは、上の「日付が決まったら…」の一言で伝える）
    if (tentative && !isCount && calendars.length === 0) {
      googleHint.append(
        el("p", "muted small", "「シフトとして追加」するには、ログインしてから、もう一度この仮シフトを押してください。"),
        loginButton,
      );
    }
  };

  // 入力内容から、Google カレンダーに送る予定を作る
  // s・e：時間（足した時間の分を作るときに渡す。なければ1つ目の時間）
  const buildEvent = (s = start.value, e = end.value) => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone; // 例 "Asia/Tokyo"
    let endDay = date.value;
    if (e <= s) {
      // 終わりが始まりより前なら、次の日に終わる（夜勤など）
      const d = parseDate(date.value);
      d.setDate(d.getDate() + 1);
      endDay = dateKey(d);
    }
    return {
      // 予定名は「バイト先 役職」。役職名が入っていれば、あとで自動でその役職として計算される
      summary: role.value ? `${place.value} ${role.value}` : place.value,
      start: { dateTime: `${date.value}T${s}:00`, timeZone },
      end: { dateTime: `${endDay}T${e}:00`, timeZone },
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
      t.count = countValue();
      if (!payMonthField.hidden && payMonth.value) t.payMonth = payMonth.value;
    } else {
      t.date = date.value;
    }
    if (breakInput.value !== "") t.breakMin = Number(breakInput.value);
    if (Number(bonus.value) > 0) t.bonus = Number(bonus.value);
    if (bonusNote.value.trim()) t.bonusNote = bonusNote.value.trim();
    return t;
  };
  // 足した時間の分の仮シフト（休憩は同じ。ボーナス・メモは1つ目の時間だけに付ける）
  const extraDraft = (x) => {
    const t = { ...draft(), id: undefined, start: x.start.value, end: x.end.value };
    delete t.bonus;
    delete t.bonusNote;
    return t;
  };
  // 足した時間の分の、予定ごとの設定（休憩だけ）
  const extraEdit = () => (breakInput.value !== "" ? { breakMin: Number(breakInput.value) } : null);

  // 入力が足りないか、過ぎていて仮シフトにできないか（理由の文字。問題なければ ""）
  const problem = () => {
    if (!start.value || !end.value) return "時間を入れてください。";
    if (kind === "count" && isTentativeMode) {
      if (!month.value) return "働く月を入れてください。";
      if (month.value < thisMonth) return "過ぎた月は仮シフトにできません。";
      return "";
    }
    if (!date.value) return "日付を入れてください。";
    const extras = activeExtras();
    if (extras.some(x => !x.start.value || !x.end.value)) return "足した時間も入れてください。";
    // 入れた時間どうしが重なっていないか（終わりが始まりより前なら次の日に終わる）
    const toMin = (v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
    const ranges = [{ s: start.value, e: end.value }, ...extras.map(x => ({ s: x.start.value, e: x.end.value }))]
      .map(r => ({ s: toMin(r.s), e: toMin(r.e) <= toMin(r.s) ? toMin(r.e) + 24 * 60 : toMin(r.e) }));
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        if (ranges[i].s < ranges[j].e && ranges[j].s < ranges[i].e) return "入れた時間どうしが重なっています。";
      }
    }
    // 仮シフト：同じ日・同じバイト先で時間が重なるシフトがもうカレンダーにあれば保存しない
    //（保存しても、シフトになった仮シフトとして自動で消えてしまうため）
    if (tentativeAllowed &&
        tentativesInCalendar([draft(), ...extras.map(extraDraft)], items.filter(x => x.shift), loadWorkplaces()).length > 0) {
      return "この時間にはもうシフトが入っています。";
    }
    if (tentativeAllowed && date.value < today) {
      return canAddToGoogle
        ? "過ぎた日付は仮シフトにできません。Google カレンダーには追加できます。"
        : "過ぎた日付は仮シフトにできません。";
    }
    return "";
  };

  // 「振り込まれる月」の選択肢を作り直す。働く日によって振り込まれる月が変わるときだけ出す
  const refreshPayMonths = (isCount) => {
    payMonthField.hidden = true;
    // 何回分かまとめたものは、その月の残りの日に割り振るので選ばない（1回分のときだけ選ぶ）
    if (!isCount || !month.value || !start.value || !end.value || countValue() > 1) return;
    const base = { ...draft(), payMonth: undefined };
    const months = possiblePayMonths(base, loadWorkplaces());
    if (months.length <= 1) return;
    // 前に選んだ月がなければ、真ん中あたりの日で働いたときの月を最初に選んでおく
    let selected = months.includes(chosenPayMonth) ? chosenPayMonth : "";
    if (!selected) {
      const s = tentativeShifts(base, loadWorkplaces())[0];
      selected = s ? s.payDate.slice(0, 7) : months[0];
    }
    payMonth.textContent = "";
    for (const m of months) payMonth.append(option(m, monthName(parseDate(`${m}-01`))));
    payMonth.value = selected;
    payMonthField.hidden = false;
  };

  // 働く時間と給料の見込みを表示する
  const update = () => {
    preview.textContent = "";
    // 長押しで開いた画面（Google カレンダーにも仮シフトにもできる）では、仮シフトにだけ関係する注意は
    // 「仮シフトとして追加」を押したときに出す（Google カレンダーには追加できるので、先に赤い字を出さない）
    const p = problem();
    const tentativeOnly = p === "この時間にはもうシフトが入っています。" || p.startsWith("過ぎた日付は仮シフトにできません");
    error.textContent = alsoTentative && canAddToGoogle && tentativeOnly ? "" : p;
    const past = (kind === "count" && isTentativeMode)
      ? month.value && month.value < thisMonth
      : date.value && date.value < today;
    saveTentative.hidden = !tentativeAllowed || past;
    if (!start.value || !end.value) return;

    const isCount = isTentativeMode && kind === "count";
    refreshPayMonths(isCount);
    // 1回分の給料（予定を押した画面と同じ計算・同じ表示。日付が未定なら、仮の日付で計算した目安）
    const t = draft();
    if (isCount ? !month.value : !date.value) return;
    const shift = isCount ? countSampleShift(t, loadWorkplaces()) : tentativeToShift(t, loadWorkplaces());
    if (!shift) return;

    breakInput.placeholder = String(shift.autoBreak);
    breakHint.textContent = `空欄ならバイト先設定どおり（${formatHours(shift.autoBreak)}）`;
    // 時間を足したときは、全部の時間を足し合わせた内訳と合計を1つだけ出す
    const extraShifts = isCount ? [] : activeExtras()
      .filter(x => x.start.value && x.end.value)
      .map(x => tentativeToShift(extraDraft(x), loadWorkplaces()))
      .filter(Boolean);
    const shown = { ...shift };
    for (const s of extraShifts) {
      for (const k of ["spanMin", "breakMin", "workMin", "nightMin", "overtimeMin",
                       "basePay", "allowance", "transport", "bonus", "pay"]) {
        shown[k] = (shown[k] || 0) + (s[k] || 0);
      }
    }
    shiftPreviewRows(preview, shown);

    if (isCount) {
      // 日付が未定：振り込まれる月（日付がないので、日ではなく月だけ出す）
      const list = tentativeShifts(t, loadWorkplaces());
      if (countValue() > 1) addRow(preview, `${countValue()}回分の合計`, formatYen(list.reduce((s, x) => s + x.pay, 0)), "strong");
      const months = [...new Set(list.map(s => s.payDate.slice(0, 7)))].sort();
      if (months.length > 0) {
        addRow(preview, "振り込まれる月", months.map(m => monthName(parseDate(`${m}-01`))).join("・"));
      }
    } else {
      addRow(preview, "振込予定日", shortDate(shift.payDate));
    }
  };
  place.onchange = () => {
    fillRoles();
    applyDefaultTimes(true); // シフト時間設定の時間（なければ前回の時間）
    showKind(); // 日給のバイト先なら「＋ 時間」を隠す
    update();
  };
  role.onchange = update;
  for (const input of [date, month, start, end, breakInput, bonus, bonusNote, countInput]) input.oninput = update;
  // 仮シフトの画面で日付を空にしたら、「未定」にする
  date.oninput = () => {
    if (isTentativeMode && !date.value) {
      undecided.checked = true;
      kind = "count";
      showKind();
    }
    // 日付を変えたら、その曜日にシフト時間設定の時間があれば入れ直す
    if (date.value) applyDefaultTimes(false);
    update();
  };

  // 次回の初期値として覚えておく
  const remember = () => {
    last.place = place.value;
    if (calendarId) last.calendarId = calendarId;
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
    // 足した時間の入れ忘れ・重なりがあれば止める（ほかの注意は仮シフトのためのものなので、ここでは止めない）
    const p = problem();
    if (p === "足した時間も入れてください。" || p === "入れた時間どうしが重なっています。") {
      error.textContent = p;
      return;
    }
    add.disabled = true;
    setLabel(add, "追加中...");
    const cal = calendars.find(c => c.id === calendarId);
    try {
      // 足した時間は、それぞれ別の予定にする（休憩だけ同じ設定を付ける）。全部いっしょに送る
      // 入れられた分は欄から消す（途中で失敗して押し直したときに、同じ予定を二重に作らない）
      const results = await Promise.allSettled([...activeExtras()].map(async (x) => {
        const made = await createEvent(calendarId, buildEvent(x.start.value, x.end.value));
        const ex = extraEdit();
        if (made && made.id && ex) {
          const all = loadEdits();
          all[`${calendarId}|${made.id}`] = ex;
          saveEdits(all);
        }
        putEventLocally(cal, made); // 読み直しを待たずに、カレンダーに出す
        extraTimes.splice(extraTimes.indexOf(x), 1);
        x.row.remove();
      }));
      const failed = results.find(r => r.status === "rejected");
      if (failed) throw failed.reason;
      const created = await createEvent(calendarId, buildEvent());
      putEventLocally(cal, created);
      // 入れた休憩・ボーナス・メモは、予定を押した画面の設定として引き継ぐ
      if (created && created.id) {
        const e = {};
        if (breakInput.value !== "") e.breakMin = Number(breakInput.value);
        if (Number(bonus.value) > 0) e.bonus = Number(bonus.value);
        if (bonusNote.value.trim()) e.bonusNote = bonusNote.value.trim();
        if (Object.keys(e).length > 0) {
          const all = loadEdits();
          all[`${calendarId}|${created.id}`] = e;
          saveEdits(all);
        }
      }
      // 仮シフトから入れたなら、仮シフトは消す（二重に数えないため）
      // 未定の仮シフト（回数つき）なら、1回分だけ減らす
      if (splitFrom) finishSplit();
      else if (tentative) removeTentative(tentative.id);
      remember();
      shiftDialog.close();
      renderAll(); // 手元の予定で先に描き直す
      onAdded();   // そのあと Google カレンダーから読み直す
    } catch (err) {
      error.textContent = err.message;
      add.disabled = false;
      setLabel(add, "シフトとして追加");
      renumberTimes();
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
    if (splitFrom && (kind === "date" || restCount > 0)) {
      // 日付未定の仮シフトの1回分に日付が決まった、または何回分かまとめたものの1回分を直した：
      // その1回分を新しい仮シフトにして、元は1回減らす（0回なら消す）
      upsertTentative({ ...draft(), id: undefined });
      finishSplit();
    } else {
      upsertTentative(draft());
    }
    // 足した時間は、それぞれ別の仮シフトにする
    for (const x of activeExtras()) upsertTentative(extraDraft(x));
    remember();
    shiftDialog.close();
    onSaved();
  };

  // 入力欄で Enter を押したとき：仮シフトの画面は仮シフトに保存、シフトを追加する画面は Google に追加
  // （長押しで開いた画面でも、Google カレンダーに追加できなければ仮シフトに保存）
  form.onsubmit = (e) => {
    e.preventDefault();
    if (isTentativeMode || (alsoTentative && !canAddToGoogle)) saveTentative.onclick();
    else submit();
  };

  applyDefaultTimes(false); // シフト時間設定で、この曜日の時間が決めてあれば入れる
  showKind();
  update();
  shiftDialog.append(form);
  shiftDialog.showModal();
}
