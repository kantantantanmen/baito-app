// ===== 「予定金額」の画面 =====
// 今年の1月〜来年の12月（24か月）について、月ごとに「稼ぎたさ」と「収入の予定」を決める。
//   ・今月までの月と、収入確定した月は「決まっている月」。実際の金額を表示するだけ
//   ・それより先の月は、稼ぎたさを選んで「案を作る」と、収入の予定が自動で入る（自分で直せる）
// 入力欄は作り直さずに、計算結果と表示の切り替えだけを毎回更新する（入力中にカーソルが外れないように）

// 予定金額で扱う24か月（今日の年の1月から）
function planMonths() {
  const year = new Date().getFullYear();
  const months = [];
  for (let i = 0; i < 24; i++) months.push(new Date(year, i, 1));
  return months;
}

// 決まっている月（今月まで、または全部確定した月）なら { value, source, usesConfirmed } を返す。
// まだ決まっていない（予定を立てる）月は null。一部だけ確定した先の月も、予定を立てる月
// 金額：確定したバイト先は確定額、確定していないバイト先はカレンダー＋仮シフト。カレンダーのシフトも確定もない月（仮シフトだけの月も）は予定金額
//   全部確定した月は確定額（予定金額は入力できない）
function fixedInfoOf(ctx, d) {
  const key = monthKey(d);
  const thisMonth = monthKey(new Date());
  const x = monthInfo(ctx.income, ctx.plans, key, true, "calendar");
  if (key > thisMonth && !x.allConfirmed) return null; // 来月から先で全部は確定していない → 予定を立てる月

  return {
    value: x.value,                // 3か月平均に使う額（平均外は除く）
    valueAll: monthInfo(ctx.income, ctx.plans, key, false, "calendar").value, // 年の合計に使う額（平均外も含む）
    source: sourceText(x),         // 「確定」「一部確定」「カレンダー」「予定金額」など
    // 確定額を使うか（使うなら入力欄を出さない）。今月までの月は、確定・自動確定・見込みを使う
    usesConfirmed: x.allConfirmed || key <= thisMonth,
  };
}

// 決まっている月なら金額だけを返す（案を作る計算に渡す用）。決まっていない月は null
//   all：false＝3か月平均用（平均外は除く）、true＝年の合計用（平均外も含む）
function fixedValueOf(ctx, d, all = false) {
  const info = fixedInfoOf(ctx, d);
  if (info) return all ? info.valueAll : info.value;
  const key = monthKey(d);
  const x = monthInfo(ctx.income, ctx.plans, key, !all, "calendar");
  // 来月から先でも、カレンダーのシフトや一部確定があって、予定金額を入れても使われない月は、
  // 表と同じ額（カレンダー・確定）で決まっている月として扱う（仮シフトだけの月は予定金額を使うので、案を作る月のまま）
  if (!usesPlanAmount(ctx, key)) return x.value;
  // 📌 で金額を固定した月も、決まっている月として扱う（金額が入っているときだけ）
  if (isPinnedMonth(ctx, key)) return x.value;
  return null;
}

// 予定金額を入れたら、その金額が使われる月か（カレンダーのシフトも確定もない月）
function usesPlanAmount(ctx, key) {
  return monthInfo(ctx.income, { ...ctx.plans, [key]: 1 }, key, true, "calendar").source === "plan";
}

// 📌 で固定していて、収入の予定が入っている月か
function isPinnedMonth(ctx, key) {
  return Boolean(loadPinned()[key]) && ctx.plans[key] != null;
}

function renderPlan(container, ctx, onChange) {
  const year = String(new Date().getFullYear());
  if (container.dataset.year !== year) buildPlan(container, ctx, onChange);
  refreshPlan(container, ctx);
}

// 表を作る
function buildPlan(container, ctx, onChange) {
  const months = planMonths();
  const first = months[0];
  const last = months[months.length - 1];
  container.dataset.year = String(first.getFullYear());
  container.textContent = "";

  // --- 説明と「案を作る」ボタン ---
  const proposeButton = el("button", "primary", "稼ぎたさから案を作る");
  proposeButton.onclick = () => {
    if (!confirm("今月より先の月の「収入の予定」を、案で上書きします（📌 で固定した月はそのまま）。よろしいですか？")) return;
    const latest = container.ctx; // 押した時点の最新のデータ（refreshPlan で毎回入れ替えている）
    const proposal = proposePlan(months, loadWeights(), (d) => fixedValueOf(latest, d),
                                 loadLimit(), loadYearLimit(), loadPlanMode(),
                                 (d) => fixedValueOf(latest, d, true)); // 年の合計は平均外も含める
    for (const [key, amount] of Object.entries(proposal)) setPlan(key, amount);
    container.dataset.year = "";   // 入力欄に新しい金額を入れるため、表を作り直す
    onChange();
  };

  // --- 上限（バイト先設定と同じ値。ここでも直せる） ---
  const monthLimitInput = numberInput(loadLimit(), 0);
  monthLimitInput.step = 1000;
  monthLimitInput.onchange = () => {
    if (Number(monthLimitInput.value) > 0) saveLimit(Number(monthLimitInput.value));
    onChange();
  };
  const yearLimitInput = numberInput(loadYearLimit(), 0);
  yearLimitInput.step = 10000;
  yearLimitInput.onchange = () => {
    if (Number(yearLimitInput.value) > 0) saveYearLimit(Number(yearLimitInput.value));
    onChange();
  };
  // 1か月に入れる金額の上限（案を作るとき、0・4・5 の月や多く稼ぐのときに使う。最初は12万円）
  const monthCapInput = numberInput(loadMonthCap(), 0);
  monthCapInput.step = 1000;
  monthCapInput.onchange = () => {
    if (Number(monthCapInput.value) > 0) saveMonthCap(Number(monthCapInput.value));
  };
  container.limitInputs = { month: monthLimitInput, year: yearLimitInput };
  const limitBox = el("div", "wp-card plan-limits");
  limitBox.append(
    field("3か月平均の上限", monthLimitInput, "円 / 月"),
    field("年の上限", yearLimitInput, "円 / 年"),
    field("1か月の上限", monthCapInput, "円 / 月"),
  );

  container.append(
    titleWithHelp("h2", `収入予定（${first.getFullYear()}年1月〜${last.getFullYear()}年12月）`, [
      "1. 来月から先の月ごとに「稼ぎたさ」を0〜5で選びます。" +
      "それぞれの月の収入の目安（枠）は、1：0〜5万円、2：5〜7万円、3：7〜9万円、4：9〜11万円、5：11万円〜です。" +
      "1・2・3は「収入を減らしたい月」です。0は「何円でもいい」月で、選んでいない月も0になります。",
      "2.「稼ぎたさから案を作る」を押すと、3か月平均と年の合計が上限を超えないことを一番に守って、来月から先の収入の予定が入ります。" +
      "枠を守る：どの月も枠の中で、年の合計ができるだけ多くなるように入れます。" +
      "多く稼ぐ：1・2・3の月は枠の上限まで、0・4・5の月は「1か月の上限」まで使って、年の合計が一番多くなるように入れます。" +
      "どちらも、稼ぎたさが高い月ほど多くなるようにし、合計が同じならなるべく平らにします。",
      "📌：金額を自分で決めたい月は、収入の予定を入れて 📌 を押します。案を作っても、その月は上書きされず、" +
      "その金額をもとにほかの月を調整します。もう一度押すと固定をやめます。",
      "3. 入った金額は自分で直せます。今月までの月と、全部のバイト先が確定した月は、確定額（自動確定・見込みを含む）を使うので入力できません。" +
      "来月から先の月でも、カレンダーのシフトや確定がある月は、予定金額ではなくその額を計算に使います（入力欄の下に出ます）。" +
      "案を作るときも、その月はその額で決まっているものとして、ほかの月を決めます。",
      "収入確定をした後にもう一度押すと、確定した金額をもとに、先の月の案を作り直します。",
      "3か月平均：先々月・先月・その月の3か月の収入の平均です（例：12月の行は10月・11月・12月の平均）。" +
      "3か月平均には、バイト先設定で平均に入れないバイト先の分は入れません。年の合計には平均外の分も入れます。" +
      "決まっている月で平均外の分があるときは、金額の下に「平均外も含めると」の額を出します。マウスを乗せると計算式が出ます。",
      "各月の金額：" + MONTH_VALUE_TEXT,
    ], "plan"),
    el("p", "muted intro",
      "月ごとに「稼ぎたさ」を選んで「稼ぎたさから案を作る」を押すと、上限を超えないように収入の予定が入ります。金額は自分で直せます。"),
    limitBox,
    container.modeBox = el("div"),   // 「枠を守る／多く稼ぐ」の切り替え（中身は refreshPlan で作る）
    proposeButton,
  );

  // --- 表 ---
  const plans = loadPlans();
  const weights = loadWeights();
  const table = el("table", "plan-table");
  const head = el("tr");
  for (const text of ["月", "稼ぎたさ", "収入の予定", "3か月平均"]) head.append(el("th", "", text));
  table.append(head);

  container.planRows = [];
  months.forEach((month, i) => {
    const key = monthKey(month);

    // 1月と最初の行には、月の上に小さく年も書く（横に並べると幅を取るので）
    const monthCell = el("td", "month-cell");
    if (i === 0 || month.getMonth() === 0) monthCell.append(el("div", "year-label", `${month.getFullYear()}年`));
    monthCell.append(monthName(month));

    // 稼ぎたさ（決まっている月は「―」）
    const weight = selectInput(WEIGHT_CHOICES, weightOf(weights, key));
    weight.onchange = () => {
      setWeight(key, Number(weight.value));
      onChange(); // 枠から外れているかの印を付け直す
    };
    const weightDash = el("span", "muted", "―");
    const weightCell = el("td");
    weightCell.append(weight, weightDash);

    // 収入の予定（決まっている月は実際の金額を表示するだけ）
    const input = numberInput(plans[key] ?? "", 0);
    input.step = 1000;
    input.placeholder = "未設定";
    input.onchange = () => {
      setPlan(key, input.value === "" ? null : Number(input.value));
      onChange();
    };
    // 📌：金額を固定する（案を作っても上書きしない）
    const pin = el("button", "pin-button", "📌");
    pin.type = "button";
    pin.onclick = () => {
      setPinned(key, !loadPinned()[key]);
      onChange();
    };
    const inputBox = el("span", "plan-input");
    inputBox.append(input, " 円", pin);
    const fixedText = el("span", "fixed-amount");
    const amountCell = el("td");
    const bandNote = el("span", "band-note"); // 枠から外れているときの印
    const usedNote = el("div", "used-note");  // 来月から先の月：計算に使う額（切り替えで変わる）
    amountCell.append(inputBox, fixedText, bandNote, usedNote);

    const avgCell = el("td", "num");
    const tr = el("tr");
    tr.append(monthCell, weightCell, amountCell, avgCell);
    table.append(tr);
    container.planRows.push({ month, key, tr, weight, weightDash, inputBox, pin, fixedText, bandNote, usedNote, avgCell });
  });

  const wrap = el("div", "table-wrap");
  wrap.append(table);
  container.planTotal = el("div", "wp-card plan-total");
  container.append(
    wrap,
    container.planTotal,
    el("p", "muted small", "上限を超える3か月は赤い枠で囲まれます。"),
  );
}

// 計算結果と表示の切り替えを更新する
function refreshPlan(container, ctx) {
  container.ctx = ctx;
  const { income, plans } = ctx;
  // 「枠を守る／多く稼ぐ」の切り替え（案を作るときに使う）
  const mode = loadPlanMode();
  const modeBox = el("div", "priority");
  modeBox.append(el("span", "priority-label", "案を作るとき、どちらを優先するか"));
  const group = el("div", "segmented");
  for (const [value, text] of [["band", "枠を守る"], ["max", "多く稼ぐ"]]) {
    const button = el("button", value === mode ? "active" : "", text);
    button.onclick = () => {
      savePlanMode(value);
      ctx.onChange();
    };
    group.append(button);
  }
  modeBox.append(group, el("p", "muted small mode-note", mode === "band"
    ? "枠を守る：それぞれの月を稼ぎたさの枠の中に収めて、その中でできるだけ多くします。"
    : "多く稼ぐ：1・2・3（減らしたい月）は枠の上限まで、0・4・5は「1か月の上限」まで使って、年の合計が一番多くなるようにします。"));
  container.modeBox.textContent = "";
  container.modeBox.append(modeBox);

  const limit = loadLimit();
  const yearLimit = loadYearLimit();

  // バイト先設定で上限が変えられていたら、こちらの入力欄にも反映する（入力中の欄はそのまま）
  for (const [input, value] of [[container.limitInputs.month, limit], [container.limitInputs.year, yearLimit]]) {
    if (document.activeElement !== input) input.value = value;
  }
  const valueOf = (d) => monthInfo(income, plans, monthKey(d), true, "calendar").value;      // 3か月平均用（平均外は除く）
  const valueAllOf = (d) => monthInfo(income, plans, monthKey(d), false, "calendar").value; // 年の合計用（平均外も含む）
  // 「カレンダー」は、この画面ではカレンダー＋仮シフトと書く
  const sourceName = (x) => {
    const s = sourceText(x);
    return s === "カレンダー" ? "カレンダー＋仮シフト" : s;
  };
  const yearSums = {};

  for (const r of container.planRows) {
    // 決まっている月か、予定を立てる月かで表示を切り替える
    // 行の種類で表示を切り替える
    //   全部確定した月    ：確定額を表示するだけ
    //   今月までの月      ：収入の予定は入力できる（稼ぎたさはなし）。案を作るときに使う金額も表示
    //   来月から先の月    ：稼ぎたさと収入の予定を入力できる
    const fixed = fixedInfoOf(ctx, r.month);
    const isConfirmed = fixed !== null && fixed.usesConfirmed;
    const isPast = fixed !== null && !isConfirmed;

    // 📌 は来月から先の月だけ。押してあれば色を付ける（金額が空のときは押してあっても固定しない）
    const pinOn = Boolean(loadPinned()[r.key]);
    r.pin.hidden = fixed !== null;
    r.pin.classList.toggle("on", pinOn);
    r.pin.title = pinOn
      ? (plans[r.key] != null ? "金額を固定中（押すとやめる）" : "金額を入れると固定されます（押すとやめる）")
      : "この金額を固定する（案を作っても上書きしない）";

    r.weight.hidden = fixed !== null;
    r.weightDash.hidden = fixed === null;
    r.inputBox.hidden = isConfirmed;
    r.fixedText.hidden = fixed === null;
    r.fixedText.textContent = "";
    if (isConfirmed) {
      r.fixedText.append(`${formatYen(fixed.value)}（${fixed.source}）`);
    } else if (isPast) {
      r.fixedText.append(`計算に使う${monthName(r.month)}の収入（平均内）：${formatYen(fixed.value)}（${fixed.source}）`);
    }
    // 平均外のバイト先の分があれば、年の合計に使う額も出す
    if (fixed !== null && fixed.valueAll !== fixed.value) {
      r.fixedText.append(el("div", "avg-range", `平均外も含めると ${formatYen(fixed.valueAll)}（年の合計に使う）`));
    }
    r.fixedText.classList.toggle("fixed-note", isPast);
    r.tr.classList.toggle("fixed", isConfirmed);
    r.tr.classList.toggle("past-month", isPast);

    // 来月から先の月：収入の予定が稼ぎたさの枠から外れていたら印を付ける
    r.bandNote.textContent = "";
    const plan = plans[r.key];
    if (fixed === null && plan != null) {
      const [lo, hi] = bandOf(weightOf(loadWeights(), r.key));
      if (plan < lo) r.bandNote.textContent = "枠より少ない";
      else if (plan > hi) r.bandNote.textContent = "枠より多い";
    }

    // 来月から先の月：シフト（カレンダー・仮シフト）や確定があって、予定金額ではなくその額を使う月だけ書く
    r.usedNote.textContent = "";
    if (fixed === null) {
      const now = monthInfo(income, plans, r.key, true, "calendar");
      const s = sourceText(now);
      if (s !== "予定金額" && s !== "―") {
        // 3か月平均に使う額（平均外のバイト先は除く）。平均外の分があれば、年の合計に使う額も出す
        // 平均外のバイト先しかない月は、下の「平均外も含めると」で分かるので、もと（平均外のみ）は書かない
        const sourcePart = now.outsideOnly ? "" : `（${sourceName(now)}）`;
        r.usedNote.append(`計算に使う${monthName(r.month)}の収入（平均内）：${formatYen(now.value)}${sourcePart}`);
        const all = valueAllOf(r.month);
        if (all !== now.value) {
          r.usedNote.append(el("div", "", `平均外も含めると ${formatYen(all)}（年の合計に使う）`));
        }
      }
    }

    // 3か月平均（先々月・先月・その月の平均）
    const m2 = addMonths(r.month, -2);
    const m1 = addMonths(r.month, -1);
    const avg3 = (valueOf(m2) + valueOf(m1) + valueOf(r.month)) / 3;
    r.avgCell.textContent = "";
    r.avgCell.append(
      el("div", "", formatYen(avg3)),
      el("div", "avg-range", `${monthRangeText(m2, r.month)}の平均`),
    );
    r.avgCell.title =
      `（${monthName(m2)} ${formatYen(valueOf(m2))} ＋ ${monthName(m1)} ${formatYen(valueOf(m1))} ＋ ` +
      `${monthName(r.month)} ${formatYen(valueOf(r.month))}）÷ 3`; // マウスを乗せると計算式が出る
    r.avgCell.classList.toggle("over", avg3 > limit);

    const y = r.month.getFullYear();
    yearSums[y] = (yearSums[y] || 0) + valueAllOf(r.month);
  }

  // 3か月平均が上限を超える期間を赤い枠で囲む
  markOverRows(container.planRows, overLimitMonths(container.planRows.map(r => r.month), valueOf, limit));

  // 年の合計
  container.planTotal.textContent = "";
  for (const [y, sum] of Object.entries(yearSums)) {
    addRow(container.planTotal, `${y}年の合計・平均外も含む（年の上限 ${formatYen(yearLimit)}）`, formatYen(sum),
           sum > yearLimit ? "over" : "");  }
}
