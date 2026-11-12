// ===== バイト先設定（バイト先と上限の保存・設定画面） =====

const WORKPLACES_KEY = "baito-workplaces";
const LIMIT_KEY = "baito-limit";
const DEFAULT_LIMIT = 108000; // 月平均の上限（円）

// 新しくバイト先を追加したときの初期値
const NEW_WORKPLACE = {
  name: "",
  payType: "hourly",   // "hourly"＝時給、"daily"＝日給
  wage: 1200,          // 時給（円）
  dailyPay: 8000,      // 日給（円）
  breakHours: 0,       // 休憩（時間）。1回のシフトから毎回引く
  transport: 0,        // 交通費（円/回）
  perShift: 0,         // 手当（円/回）。役職なしのシフトに付く（役職のシフトは役職の手当）
  perHour: 0,          // 手当（円/時）
  nightStart: "22:00", // 夜間の始まり
  nightEnd: "05:00",   // 夜間の終わり
  nightWage: 0,        // 夜間の時給（0 なら基本と同じ＝1倍）
  overtimeAfterHours: 8, // 1日に何時間を超えたら残業か
  overtimeWage: 0,     // 残業の時給（0 なら基本と同じ＝1倍）
  inAverage: true,     // 3か月平均・来月の上限の計算に入れるか
  payCycle: "month",   // 支払い："month"＝月払い、"week"＝週払い、"sameday"＝当日払い
  weekCloseDay: 0,     // 週払いの締め曜日（0＝日曜 … 6＝土曜）
  weekPayOffset: 1,    // 週払いの支払いの週：0＝当週、1＝翌週、2＝翌々週
  weekPayDay: 6,       // 週払いの支払い曜日
  autoConfirmTiming: "pay", // 自動確定（翌月払い以外）："pay"＝勤務が入らなくなったらすぐ、"monthEnd"＝その月が終わったら
  closingDay: 0,       // 締め日（0 は末日）
  payMonthOffset: 1,   // 給料日の月：0＝当月、1＝翌月、2＝翌々月
  payDay: 25,          // 給料日（0 は末日）
  roles: [],           // 役職 [{ name: "キッチン", wage: 1200, perShift: 0, perHour: 0 }, ...]
};

// 締め日・給料日の選択肢 [[値, 表示], ...]
const CLOSING_CHOICES = [[0, "末日"]];
for (let d = 1; d <= 28; d++) CLOSING_CHOICES.push([d, `${d}日`]);
const PAY_DAY_CHOICES = [[0, "末日"]];
for (let d = 1; d <= 31; d++) PAY_DAY_CHOICES.push([d, `${d}日`]);
const PAY_MONTH_CHOICES = [[0, "当月"], [1, "翌月"], [2, "翌々月"]];
const PAY_CYCLE_CHOICES = [["month", "月払い"], ["week", "週払い"], ["sameday", "当日払い"]];
// 週の始まりは月曜日。値は Date の getDay() と同じ（日曜 = 0）
const WEEKDAY_CHOICES = [1, 2, 3, 4, 5, 6, 0].map(i => [i, `${"日月火水木金土"[i]}曜`]);
const PAY_WEEK_CHOICES = [[0, "当週"], [1, "翌週"], [2, "翌々週"]];
const AUTO_TIMING_CHOICES = [["pay", "勤務が入らなくなったらすぐ"], ["monthEnd", "その月が終わったら"]];

// ===== 保存と読み込み =====

function loadWorkplaces() {
  try {
    const list = JSON.parse(localStorage.getItem(WORKPLACES_KEY)) || [];
    // 前の形で保存されたデータにも、足りない項目を初期値で補う
    // { ...A, ...B } は「A をコピーしてから B で上書きしたもの」
    return list.map(wp => ({ ...NEW_WORKPLACE, ...wp }));
  } catch {
    return [];
  }
}

function saveWorkplaces(list) {
  localStorage.setItem(WORKPLACES_KEY, JSON.stringify(list));
}

function loadLimit() {
  const v = Number(localStorage.getItem(LIMIT_KEY));
  return v > 0 ? v : DEFAULT_LIMIT;
}

function saveLimit(v) {
  localStorage.setItem(LIMIT_KEY, String(v));
}

// 年の合計の上限（円）
const YEAR_LIMIT_KEY = "baito-year-limit";
const DEFAULT_YEAR_LIMIT = 1300000;

function loadYearLimit() {
  const v = Number(localStorage.getItem(YEAR_LIMIT_KEY));
  return v > 0 ? v : DEFAULT_YEAR_LIMIT;
}

function saveYearLimit(v) {
  localStorage.setItem(YEAR_LIMIT_KEY, String(v));
}

// ===== 入力欄の部品 =====

function numberInput(value, min) {
  const input = el("input");
  input.type = "number";
  input.min = min;
  input.value = value;
  return input;
}

function textInput(value, placeholder) {
  const input = el("input");
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  return input;
}

// ラジオボタン（どれか1つだけ選べる丸いボタン）。同じ group のものから1つ選ぶ
function radio(group, checked, text) {
  const input = el("input");
  input.type = "radio";
  input.name = group;
  input.checked = checked;
  const label = el("label", "check");
  label.append(input, text);
  return { input, label };
}

// 「項目名 | 入力欄など」の1行
function field(labelText, ...children) {
  const row = el("div", "field");
  const body = el("div", "field-body");
  body.append(...children);
  row.append(el("span", "field-label", labelText), body);
  return row;
}

// 入力欄の行の最後に「？」を付け、押すとその下に説明が出るようにする（行と説明をまとめて返す）
function fieldWithHelp(row, key, lines) {
  const { button, text } = helpParts(`field:${key}`, lines);
  row.querySelector(".field-body").append(button);
  text.classList.add("field-help");
  const box = document.createDocumentFragment();
  box.append(row, text);
  return box;
}

// ===== バイト先1件分のカード =====
// save：保存して計算し直す、rerender：設定画面を作り直す
function workplaceCard(list, i, save, rerender) {
  const wp = list[i];
  const card = el("div", "wp-card");

  const name = textInput(wp.name, "例：カフェ");
  const del = el("button", "danger", "削除");
  del.onclick = () => {
    if (!confirm(`「${name.value || "名前なし"}」を削除しますか？`)) return;
    list.splice(i, 1); // i 番目を1件取り除く
    save();
    rerender();
  };

  const hourly = radio(`pay-type-${i}`, wp.payType === "hourly", "時給");
  const daily = radio(`pay-type-${i}`, wp.payType === "daily", "日給");

  const wage = numberInput(wp.wage, 0);

  // 夜間：何時〜何時を、時給何円にするか。最初は基本の時給と同じ金額（1倍）が入っている
  const nightStart = timeInput(wp.nightStart);
  const nightEnd = timeInput(wp.nightEnd);
  const nightWage = numberInput(wp.nightWage || wp.wage, 0);

  // 残業：1日に何時間を超えたら、時給何円にするか。最初は基本の時給と同じ金額（1倍）
  const overtimeAfter = numberInput(wp.overtimeAfterHours, 0);
  overtimeAfter.step = 0.5;
  const overtimeWage = numberInput(wp.overtimeWage || wp.wage, 0);

  // 基本の時給を変えたとき、夜間・残業が基本と同じ金額のままなら一緒に変える
  let prevWage = wp.wage;
  wage.addEventListener("change", () => {
    if (Number(nightWage.value) === Number(prevWage)) nightWage.value = wage.value;
    if (Number(overtimeWage.value) === Number(prevWage)) overtimeWage.value = wage.value;
    prevWage = wage.value;
  });

  // 時給のときだけ出す欄
  const wageField = el("div");
  wageField.append(
    field("時給", wage, "円"),
    field("夜間", nightStart, "〜", nightEnd, "は時給", nightWage, "円"),
    fieldWithHelp(field("残業", "1日", overtimeAfter, "時間を超えた分は時給", overtimeWage, "円"), `night:${i}`, [
      "夜間・残業の時給は、最初は基本の時給と同じ金額（1倍）です。割増がある場合は金額を書き換えてください。",
      "夜間と残業が重なった時間は、両方の上乗せ分を足します。",
    ]),
  );

  const dailyPay = numberInput(wp.dailyPay, 0);
  const dailyField = field("日給", dailyPay, "円（同じ日に予定が2つあっても1日分）");

  const breakHours = numberInput(wp.breakHours, 0);
  breakHours.step = 0.25; // 15分きざみ（0.5＝30分、0.75＝45分）

  const transport = numberInput(wp.transport, 0);
  transport.step = 10;

  // 手当（役職なしのシフトに付く）：1回ごと と 1時間ごと を縦に並べる
  const perShift = numberInput(wp.perShift || "", 0);
  const perHour = numberInput(wp.perHour || "", 0);
  perShift.placeholder = "0";
  perHour.placeholder = "0";
  const allowanceLines = (a, b) => {
    const box = el("div", "allowance-box");
    const l1 = el("div", "role-line");
    l1.append(a, "円/回");
    const l2 = el("div", "role-line");
    l2.append(b, "円/時");
    box.append(l1, l2);
    return box;
  };

  // 支払いのタイミング
  const payCycle = selectInput(PAY_CYCLE_CHOICES, wp.payCycle);
  const closing = selectInput(CLOSING_CHOICES, wp.closingDay);
  const payMonth = selectInput(PAY_MONTH_CHOICES, wp.payMonthOffset);
  const payDay = selectInput(PAY_DAY_CHOICES, wp.payDay);
  const monthFields = el("div");
  monthFields.append(
    field("締め日", closing, "締め"),
    field("給料日", payMonth, payDay, "払い"),
  );
  const weekClose = selectInput(WEEKDAY_CHOICES, wp.weekCloseDay);
  const weekOffset = selectInput(PAY_WEEK_CHOICES, wp.weekPayOffset ?? 1);
  const weekPay = selectInput(WEEKDAY_CHOICES, wp.weekPayDay);
  const weekFields = el("div");
  weekFields.append(
    fieldWithHelp(field("週払い", weekClose, "締め・", weekOffset, "の", weekPay, "払い"), `week:${i}`,
      "週は月曜〜日曜で数えます。締め日がある週が「当週」、その次の週が「翌週」です。"),
  );

  // 自動確定のタイミング（翌月払い以外で選べる。当日払いは説明だけ）
  const autoTiming = selectInput(AUTO_TIMING_CHOICES, wp.autoConfirmTiming);
  const autoTimingFields = el("div");
  autoTimingFields.append(
    fieldWithHelp(field("自動確定", autoTiming), `auto:${i}`, [
      "◯月の収入を、カレンダーからの額で自動確定するタイミングです。",
      "「すぐ」：今日働いた分の振込日が◯月より後になった時点で確定します（もう◯月の収入は増えないため）。",
      "「その月が終わったら」：◯月が終わった時点でまとめて確定します。",
    ]),
  );
  const autoTimingNote = el("p", "muted small field-note");

  const inAverage = el("input");
  inAverage.type = "checkbox";
  inAverage.checked = wp.inAverage;
  const inAverageLabel = el("label", "check");
  inAverageLabel.append(inAverage, "3か月平均・来月の上限の計算に入れる");

  // --- 役職 ---
  // 1行ずつ { name, wage, perShift, perHour, del } の入力欄を作る
  const roles = wp.roles || [];
  const roleInputs = roles.map((role, j) => {
    const r = {
      name: textInput(role.name, "例：キッチン"),
      wage: numberInput(role.wage || "", 0),
      perShift: numberInput(role.perShift || "", 0),
      perHour: numberInput(role.perHour || "", 0),
      del: el("button", "wp-delete", "×"),
    };
    r.wage.placeholder = "基本と同じ";
    r.perShift.placeholder = "0";
    r.perHour.placeholder = "0";
    r.del.title = "この役職を削除";
    r.del.onclick = () => {
      // list[i] は入力のたびに作り直されるので、いつも list[i] の最新の役職から消す
      list[i].roles = (list[i].roles || []).filter((_, k) => k !== j);
      save();
      rerender();
    };
    return r;
  });

  const roleBox = el("div", "role-box");
  for (const r of roleInputs) {
    const row = el("div", "role-row");
    const line1 = el("div", "role-line");
    line1.append(r.name, r.del);
    const line2 = el("div", "role-line");
    line2.append("時給", r.wage, "円");
    // 手当
    // ▭円/回
    // ▭円/時
    row.append(line1, line2, el("div", "role-line", "手当"), allowanceLines(r.perShift, r.perHour));
    roleBox.append(row);
  }
  const addRole = el("button", "", "＋ 役職を追加");
  addRole.type = "button";
  addRole.onclick = () => {
    list[i].roles = [...(list[i].roles || []), { name: "", wage: 0, perShift: 0, perHour: 0 }];
    save();
    rerender();
  };
  roleBox.append(
    addRole,
    el("p", "muted small", "予定名に役職名が入っていると、その役職で計算します（例：「カフェ キッチン」）。" +
      "役職のシフトには、上の「手当」ではなく役職の手当が付きます。"),
  );

  card.append(
    field("予定名", name, del),
    field("計算方法", hourly.label, daily.label),
    wageField,
    dailyField,
    field("休憩", breakHours, "時間（0.5＝30分）"),
    field("交通費", transport, "円/回"),
    field("手当", allowanceLines(perShift, perHour)),
    field("支払い", payCycle),
    monthFields,
    weekFields,
    autoTimingFields,
    autoTimingNote,
    field("扶養", inAverageLabel),
    field("役職", roleBox),
  );

  // 時給・日給の選択に合わせて、使う欄だけ見せる
  // 支払いの種類に合わせて、締め日などの欄を出し分ける（当日払いは何も出さない）
  const showFields = () => {
    wageField.hidden = !hourly.input.checked;
    dailyField.hidden = !daily.input.checked;
    monthFields.hidden = payCycle.value !== "month";
    weekFields.hidden = payCycle.value !== "week";
    // 自動確定のタイミング：翌月払い以外で選べる
    const current = { payCycle: payCycle.value, payMonthOffset: Number(payMonth.value) };
    autoTimingFields.hidden = !hasAutoTimingChoice(current);
    autoTimingNote.hidden = autoTimingFields.hidden;
    autoTimingNote.textContent = "";
    if (payCycle.value === "sameday") {
      autoTimingNote.hidden = false;
      autoTimingNote.textContent = "自動確定：当日払いは、◯月が終わった時点でカレンダーからの額で自動確定します。";
    } else if (payCycle.value === "month" && Number(payMonth.value) === 1) {
      autoTimingNote.hidden = false;
      autoTimingNote.textContent = "自動確定：翌月払いは、もう勤務が入らなくなった時点（締めた後）でカレンダーからの額で自動確定します。";
    }
  };
  showFields();

  // どれかの欄が変わったら、画面の内容をまとめて保存する
  const update = () => {
    // 名前を変えたら、前の名前で保存しているもの（確定額・仮シフトなど）も新しい名前に付け替える
    const oldName = list[i].name;
    const newName = name.value.trim();
    if (oldName && newName && oldName !== newName && !list.some((w, j) => j !== i && w.name === newName)) {
      renameWorkplaceData(oldName, newName);
    }
    list[i] = {
      name: name.value.trim(),
      payType: daily.input.checked ? "daily" : "hourly",
      wage: Number(wage.value) || 0,
      dailyPay: Number(dailyPay.value) || 0,
      breakHours: Number(breakHours.value) || 0,
      transport: Number(transport.value) || 0,
      perShift: Number(perShift.value) || 0,
      perHour: Number(perHour.value) || 0,
      nightStart: nightStart.value || "22:00",
      nightEnd: nightEnd.value || "05:00",
      // 基本の時給と同じ金額なら 0（＝基本と同じ）として保存する
      nightWage: Number(nightWage.value) === Number(wage.value) ? 0 : Number(nightWage.value) || 0,
      overtimeAfterHours: overtimeAfter.value === "" ? 8 : Number(overtimeAfter.value),
      overtimeWage: Number(overtimeWage.value) === Number(wage.value) ? 0 : Number(overtimeWage.value) || 0,
      inAverage: inAverage.checked,
      payCycle: payCycle.value,
      weekCloseDay: Number(weekClose.value),
      weekPayOffset: Number(weekOffset.value),
      weekPayDay: Number(weekPay.value),
      autoConfirmTiming: autoTiming.value,
      closingDay: Number(closing.value),
      payMonthOffset: Number(payMonth.value),
      payDay: Number(payDay.value),
      roles: roleInputs.map(r => ({
        name: r.name.value.trim(),
        wage: Number(r.wage.value) || 0,
        perShift: Number(r.perShift.value) || 0,
        perHour: Number(r.perHour.value) || 0,
      })),
    };
    showFields();
    save();
  };
  const roleFields = roleInputs.flatMap(r => [r.name, r.wage, r.perShift, r.perHour]);
  for (const input of [name, hourly.input, daily.input, wage, dailyPay, breakHours, transport, perShift, perHour,
                       nightStart, nightEnd, nightWage, overtimeAfter, overtimeWage,
                       payCycle, weekClose, weekOffset, weekPay, autoTiming, closing, payMonth, payDay, inAverage, ...roleFields]) {
    input.onchange = update;
  }

  return card;
}

// ===== バイト先の名前を変えたとき =====
// バイト先の名前は、確定額・自動確定・仮シフト・予定ごとの入力・前回の入力で、バイト先を見分けるのに使っている。
// 名前を変えたら、それらを全部 oldName → newName に付け替える（そうしないと前の名前のまま残って表示される）
function renameWorkplaceData(oldName, newName) {
  const readJSON = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch {
      return fallback;
    }
  };
  const writeJSON = (key, value) => localStorage.setItem(key, JSON.stringify(value));

  // 確定額 { "2026-11": { "カフェ": 54321 } }（新しい名前の額がもうあれば、そちらを残す）
  const confirmed = loadConfirmed();
  for (const month of Object.keys(confirmed)) {
    const m = confirmed[month];
    if (!(oldName in m)) continue;
    if (!(newName in m)) m[newName] = m[oldName];
    delete m[oldName];
  }
  writeJSON(CONFIRMED_KEY, confirmed);

  // 自動確定の印 { "2026-10": ["カフェ"] }
  const auto = loadMonthLists(AUTO_KEY);
  for (const month of Object.keys(auto)) {
    auto[month] = [...new Set(auto[month].map(p => (p === oldName ? newName : p)))];
  }
  saveMonthLists(AUTO_KEY, auto);

  // 予定ごとの入力（予定を押した画面で選んだバイト先）
  const edits = readJSON(EDITS_KEY, {});
  for (const e of Object.values(edits)) {
    if (e.place === oldName) e.place = newName;
  }
  writeJSON(EDITS_KEY, edits);

  // 仮シフト
  saveTentatives(loadTentatives().map(t => (t.place === oldName ? { ...t, place: newName } : t)));

  // シフト追加の画面で覚えている前回の入力
  const last = readJSON(LAST_SHIFT_KEY, null);
  if (last) {
    if (last.place === oldName) last.place = newName;
    for (const k of ["times", "roles"]) {
      if (last[k] && oldName in last[k]) {
        last[k][newName] = last[k][oldName];
        delete last[k][oldName];
      }
    }
    writeJSON(LAST_SHIFT_KEY, last);
  }
}

// ===== バイト先設定の画面全体 =====
// 設定が変わったら onChange を呼ぶ（カレンダーと集計を計算し直すため）
function renderSettings(container, onChange) {
  const list = loadWorkplaces();
  const save = () => {
    saveWorkplaces(list);
    onChange();
  };
  const rerender = () => renderSettings(container, onChange);

  container.textContent = "";
  container.appendChild(el("h2", "settings-title", "バイト先設定"));

  // --- バイト先 ---
  const wpSection = el("section", "settings-section");
  wpSection.append(
    titleWithHelp("h3", "バイト先", [
      "カレンダーの予定名に「予定名」の文字が含まれていると、そのバイト先のシフトとして計算します。",
      "変更は自動で保存されます。",
    ], "settings-wp"),
  );
  if (list.length === 0) {
    wpSection.appendChild(el("p", "note", "まだバイト先が登録されていません。"));
  }
  list.forEach((wp, i) => wpSection.appendChild(workplaceCard(list, i, save, rerender)));

  const add = el("button", "", "＋ バイト先を追加");
  add.onclick = () => {
    list.push({ ...NEW_WORKPLACE });
    save();
    rerender();
  };
  wpSection.appendChild(add);
  container.appendChild(wpSection);

  // --- 扶養の上限 ---
  const limitSection = el("section", "settings-section");
  const limit = numberInput(loadLimit(), 0);
  limit.step = 1000;
  limit.onchange = () => {
    if (Number(limit.value) > 0) saveLimit(Number(limit.value));
    onChange();
  };
  const yearLimit = numberInput(loadYearLimit(), 0);
  yearLimit.step = 10000;
  yearLimit.onchange = () => {
    if (Number(yearLimit.value) > 0) saveYearLimit(Number(yearLimit.value));
    onChange();
  };
  limitSection.append(
    titleWithHelp("h3", "扶養の上限", [
      "月平均の上限：3か月平均がこの金額を超えないかをチェックします。",
      "年の上限：1〜12月の収入の合計の上限です。",
    ], "settings-limit"),
    field("月平均の上限", limit, "円"),
    field("年の上限", yearLimit, "円"),
    el("p", "muted", "目安：年130万円なら月108,000円、19〜22歳で年150万円なら月125,000円。"),
  );
  container.appendChild(limitSection);
}
