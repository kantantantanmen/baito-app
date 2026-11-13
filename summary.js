// ===== 右の集計パネル（◯月の収入＝その月に振り込まれる額で数える） =====

// 開いている「？」の説明と「▶」の詳細を覚えておく（右のパネルは作り直されることが多いので、閉じないように）
const openedParts = new Set();

// ▶ で開く詳細（<details>）を作る。name ごとに開いた状態を覚える
function rememberedDetails(name, className) {
  const d = el("details", className);
  d.open = openedParts.has(name);
  d.addEventListener("toggle", () => {
    if (d.open) openedParts.add(name);
    else openedParts.delete(name);
  });
  return d;
}

// 見出しつきの箱を作る
// help を渡すと、見出しの横に「？」ボタンが付き、押すと見出しの下に説明が出る（もう一度押すと消える）
function panelBox(title, help) {
  const box = el("section", "panel-box");
  const head = el("div", "box-head");
  head.append(el("h3", "", title));
  box.appendChild(head);
  if (help) {
    const button = el("button", "help-btn", "？");
    button.type = "button";
    button.title = "説明を見る";
    const text = el("div", "help-text");
    const key = `help:${title}`;
    text.hidden = !openedParts.has(key);
    button.classList.toggle("open", !text.hidden);
    for (const line of [].concat(help)) text.append(el("p", "", line)); // 1行でも複数行でも渡せる
    button.onclick = () => {
      text.hidden = !text.hidden;
      button.classList.toggle("open", !text.hidden);
      if (text.hidden) openedParts.delete(key);
      else openedParts.add(key);
    };
    head.append(button);
    box.appendChild(text);
  }
  return box;
}

// 「名前 …… 金額」の1行。label は文字でも部品でもよい
function addRow(box, label, value, className = "") {
  const row = el("div", `row ${className}`);
  const labelEl = el("span");
  labelEl.append(label);
  row.append(labelEl, el("span", "value", value));
  box.appendChild(row);
}

// 金額の出どころを示す小さい札。kind: "confirmed"、"expect"、"calendar"
const BADGE_TEXT = { confirmed: "確定", expect: "見込み", calendar: "カレンダー" };

// 1件分（incomeByMonth の r）の札の種類。自動確定も「確定」（見分けは収入確定の画面で一言添える）
function badgeKind(r) {
  if (r.expected) return "expect";
  if (r.confirmed === null) return "calendar";
  return "confirmed";
}
function badge(kind) {
  return el("span", `badge ${kind}`, BADGE_TEXT[kind]);
}

// 「11月収入〜1月収入」のような文字
function rangeName(months) {
  return `${monthName(months[0])}収入〜${monthName(months[months.length - 1])}収入`;
}

// 未確定の月の金額の決まり方（集計・予定金額の画面の説明に使う）
// カレンダー＋仮シフトを使い、カレンダーのシフトがない月（仮シフトだけの月も）は予定金額（カレンダー優先）。切り替えはない
const MONTH_VALUE_TEXT =
  "今月までの月と、全部のバイト先が確定した月は、確定額（自動確定・見込みを含む）。" +
  "来月から先のまだ決まっていない月は、確定したバイト先は確定額、ほかはカレンダー＋仮シフトから計算した額。" +
  "カレンダーのシフトがない月は、仮シフトだけが入っていても、予定金額に入力があればその額を使います。" +
  "シフトが一部だけ入っている月は、入るつもりの分を仮シフトで足すと実際に近くなります。";

// ある月の収入の箱。バイト先ごとに「振込日・どの期間の勤務か・金額」を並べる
// slot：箱の名前（"this" や "next"）。内訳を開いた状態を覚えるのに使う
// extraRows：合計の下に足す行 [[名前, 金額の文字, クラス名], ...]（来月の箱の「カレンダー＋仮シフト」など）
// tentatives：この月に振り込まれる仮シフト [{ t, shift }]、tentativeNote：その見出しに添える一言
// helpExtra：「？」の説明の最初に足す一言
function incomeBox(title, subtitle, income, month, info, slot, extraRows = [], tentatives = [], tentativeNote = "",
                   helpExtra = "") {
  // 説明は、その月に出てくる札（確定・見込み・カレンダー）の分だけ書く
  //   過ぎた月：確定だけ、今月：確定と見込み、先の月：確定とカレンダー
  const key = monthKey(month);
  const thisMonth = monthKey(new Date());
  const badgeHelp = ["「確定」はもう決まった金額です（収入確定で入れた額か、もう勤務が入らなくなってカレンダーの額で自動で確定した額）。"];
  if (key === thisMonth) {
    badgeHelp.push("「見込み」は、この月の収入でまだ増える分です。カレンダー＋仮シフトの額を使います。");
  } else if (key > thisMonth) {
    badgeHelp.push("「カレンダー」は、カレンダーのシフトから計算した、まだ確定していない額です。");
  }
  const box = panelBox(title, [
    ...(helpExtra ? [helpExtra] : []),
    `${monthName(month)}に振り込まれる給料です。同じ月に働いても、当月払いか翌月払いかで入る月が変わります（バイト先設定の締め日・給料日）。`,
    badgeHelp.join(""),
  ]);
  box.appendChild(el("p", "subtitle", subtitle));
  const rows = monthRows(income, monthKey(month)).filter(r => r.count > 0 || r.confirmed !== null);

  // まず合計だけを大きく出す
  addRow(box, "合計", formatYen(info.value), "big");
  if (info.source === "actual" && info.expected > 0) {
    box.appendChild(el("p", "muted", `うち見込み ${formatYen(info.expected)}`));
  }
  if (slot !== "next" && info.source === "actual" && info.value > info.confirmed) { // 来月の箱には出さない
    box.appendChild(el("p", "muted", `うち未確定 ${formatYen(info.value - info.confirmed)}`));
  }
  for (const [label, value, className] of extraRows) addRow(box, label, value, className || "");

  // バイト先ごとの内訳は ▶ を押すと開く（開いた状態は箱ごとに覚える）
  const details = rememberedDetails(`income:${slot}`, "breakdown");
  details.append(el("summary", "", "内訳"));
  if (info.source === "plan") {
    // 予定金額の金額を使っている月は、内訳を出さずに一言だけ
    details.append(el("p", "muted", "予定金額の金額で見込んでいます。"));
  } else if (rows.length === 0) {
    details.append(el("p", "muted", tentatives.length > 0
      ? "カレンダーには、この月に振り込まれるシフトはまだありません。"
      : "この月に振り込まれる給料はまだありません。"));
  } else {
    for (const r of rows) {
      const label = el("span", "income-label");
      label.append(`${r.place}${r.inAverage ? "" : "（平均外）"} `, badge(badgeKind(r)));
      if (r.count > 0) {
        // どの勤務がこの月の収入になるか（当月払い・翌月払いで変わる）
        const tentativeText = r.tentativeCount > 0 ? `（うち仮${r.tentativeCount}回）` : "";
        label.append(el("span", "income-detail",
          `${payDatesText(r.payDates)} ・ ${shortDate(r.firstDay)}〜${shortDate(r.lastDay)}の勤務${r.count}回${tentativeText}`));
      }
      addRow(details, label, formatYen(r.value));
    }
  }
  // 仮シフトの1回ずつ（日付・時間・バイト先・振込日・金額）
  if (info.source !== "plan" && tentatives.length > 0) {
    const sum = tentatives.reduce((s, x) => s + x.shift.pay, 0);
    const times = tentatives.reduce((s, x) => s + (x.count || 1), 0);
    details.append(el("p", "tentative-sub", `仮シフト ${times}回・${formatYen(sum)}${tentativeNote}`));
    for (const { t, shift, count } of tentatives) {
      const label = el("span", "income-label");
      const who = [shift.place, shift.role].filter(Boolean).join(" ");
      // 日付が未定のものは「12月中・日付未定 17:00-22:00」、日付ありは「12/5 17:00-22:00」
      const when = isCountTentative(t)
        ? `${monthName(parseDate(`${t.month}-01`))}中・日付未定 ${t.start}-${t.end}${count > 1 ? ` × ${count}回` : ""}`
        : `${shortDate(t.date)} ${t.start}-${t.end}`;
      label.append(`${when} ${who}`);
      label.append(el("span", "income-detail", `${shortDate(shift.payDate)}振込 ・ ${formatHours(shift.workMin)}`));
      addRow(details, label, formatYen(shift.pay), "tentative-line");
    }
  }
  box.appendChild(details);
  return box;
}

// month に振り込まれる仮シフトだけ取り出す
function tentativesFor(list, month) {
  return (list || []).filter(x => monthKey(parseDate(x.shift.payDate)) === monthKey(month));
}

// ctx: { income, incomeCalendar, plans, activeTentatives, shifts, viewMonth, unmatched, workplaces, onChange }
// （app.js の renderAll が作る）
function renderSummary(container, ctx) {
  const { income, plans, viewMonth, unmatched, workplaces } = ctx;
  const limit = loadLimit();

  const m0 = viewMonth;               // 表示中の月
  const n1 = addMonths(viewMonth, 1); // 来月

  // 未確定の月 ＝ カレンダー＋仮シフト。確定もカレンダーのシフトもない月は予定金額
  const info = (d, onlyAverage = false) => monthInfo(income, plans, monthKey(d), onlyAverage, "calendar");
  const avgValue = (d) => info(d, true).value; // 平均・上限に使う金額

  container.textContent = "";

  // ---------- 1. 今月の収入 ----------
  // 合計の下に、3か月平均の計算に入れる額（平均外のバイト先の分を除く。集計の月平均の表の「収入」と同じ）
  const box0 = incomeBox(`${monthName(m0)}の収入`, `${monthName(m0)}に振り込まれる給料`, income, m0, info(m0), "this",
                         [["うち平均に入る額", formatYen(avgValue(m0)), "ref"]],
                         tentativesFor(ctx.activeTentatives, m0), "（上の金額に入っています）",
                         "「うち平均に入る額」は、合計のうち3か月平均の計算に入れる額です（平均外のバイト先の分は入れません）。" +
                         "集計の月平均の表の「収入」（カレンダー優先）と同じ額です。");
  if (unmatched > 0) {
    box0.appendChild(el("p", "note",
      `バイト先に当てはまらない時間つきの予定が${monthName(m0)}に${unmatched}件あります。シフトなら「バイト先設定」でバイト先を登録してください。`));
  }
  container.appendChild(box0);

  // ---------- 2. 来月の収入（合計はカレンダーのシフトだけで計算） ----------
  // 合計の下に、参考として「カレンダー＋仮シフト」と「予定金額」も出す。全部確定していなければ「（予定）」を付ける
  const incomeCalendar = ctx.incomeCalendar || income;
  const i1 = monthInfo(incomeCalendar, {}, monthKey(n1), false, "calendar");
  const n1Fixed = i1.allConfirmed;
  const withTentative = monthInfo(income, {}, monthKey(n1), false, "calendar").value; // カレンダー＋仮シフト
  const plan1 = planFor(plans, monthKey(n1));
  const nextExtra = [
    ["カレンダー＋仮シフト", formatYen(withTentative), "big"], // 合計と同じ大きさで出す
    // 3か月平均に入れる額（集計の月平均の表の「収入」、カレンダー優先と同じ）
    ["うち平均に入る額", formatYen(avgValue(n1)), "ref"],
    [`参考：予定金額の${monthName(n1)}`, plan1 == null ? "未設定" : formatYen(plan1), "ref"],
  ];
  container.appendChild(
    incomeBox(`${monthName(n1)}の収入${n1Fixed ? "" : "（予定）"}`,
              `${monthName(n1)}に振り込まれる給料`, incomeCalendar, n1, i1, "next",
              nextExtra, tentativesFor(ctx.activeTentatives, n1), "",
              "合計は、カレンダーのシフトだけで計算しています（仮シフトは入れません）。" +
              "仮シフトも入れた額は「カレンダー＋仮シフト」の行に出しています。" +
              "「うち平均に入る額」は、そのうち3か月平均の計算に入れる額です（平均外のバイト先の分は入れません）。" +
              "集計の月平均の表の「収入」（カレンダー優先）と同じ額です。" +
              "カレンダーのシフトがない月（仮シフトだけの月も）は、予定金額に入力があればその額になります。" +
              "「参考：予定金額」は予定金額の画面で入れた金額で、合計には入れていません。"));

  // ---------- 3. 来月の収入の上限（＝今月どれだけ働いてよいか） ----------
  // 翌月払いなら、今月働いた分は来月の収入になる
  const target = n1; // 上限を出す月（来月の収入）
  const cap = capForMonth(target, avgValue, limit, plans);

  // 年の上限から：年の上限から、その年の1月〜対象の月の前の月までの収入を順に引いた残り（どれだけ余裕があるか）
  //   各月の金額は、カレンダー優先で決まる額を引く
  const yearLimit = loadYearLimit();
  const year = target.getFullYear();
  let otherMonths = 0;
  const yearBreakdown = []; // 内訳の表示用 [{ d, value, source }]
  for (let m = 0; m < target.getMonth(); m++) {
    const d = new Date(year, m, 1);
    const x = info(d);
    otherMonths += x.value;
    const source = sourceText(x); // 集計の「もと」と同じ書き方（確定がある月は必ず「確定」が付く）
    yearBreakdown.push({ d, value: x.value, source });
  }
  const yearCap = yearLimit - otherMonths;

  // 大きく出す上限：4つ（年の上限から・3か月平均2つ・予定金額）の中で一番小さい数字。
  // その月に入ってくるお金全部（平均外も含む）の上限として使う
  const minAll = Math.min(cap.min, yearCap);
  const result = Math.max(0, minAll);

  // 対象の月の収入として、カレンダーにもう入っている分・仮シフトの分（平均外も含む全部）と、残り
  //   あと ＝ 上限 − カレンダーから − 仮シフト  → 「カレンダーから ＋ 仮シフト ＋ あと ＝ 上限」になる
  const sumRows = (inc) => monthRows(inc, monthKey(target)).reduce((sum, r) => sum + r.value, 0);
  const calendarAll = sumRows(incomeCalendar);
  const tentativeAll = sumRows(income) - calendarAll;
  const remain = result - calendarAll - tentativeAll;

  const box1 = panelBox(`${monthName(target)}の収入はいくらまで？`, [
    `${monthName(target)}に入ってくるお金全部（平均外も含む）の上限です。翌月払いなら、${monthName(m0)}に働いた分が${monthName(target)}の収入になります。`,
    "上限は「年の上限から」「3か月平均2つ」「予定金額」の4つの中で一番小さい金額です。「上限の決まり方」を押すと中身が見られます。",
    `年の上限から ＝ 年の上限 −（${year}年1月〜${monthName(target)}の前の月までの収入）。`,
    "各月の金額：今月までの月と全部確定した月は確定額（自動確定・見込みを含む）。" +
    "まだ決まっていない月は、確定したバイト先は確定額、ほかはカレンダー＋仮シフトの額。カレンダーのシフトも確定もない月（仮シフトだけの月も）は、予定金額に入力があればその額を使います。",
    `あと ＝ 上限 − カレンダーから − 仮シフト。上限：3か月平均は月 ${formatYen(limit)}、年は ${formatYen(yearLimit)}（バイト先設定で変更できます）。`,
    "平均外ならあと ＝ 年の上限から − カレンダーから − 仮シフト。3か月平均に入れない（平均外の）バイト先なら、3か月平均と予定金額は関係ないので、年の上限までこれだけ稼げます。",
  ]);
  box1.appendChild(el("p", "subtitle", `${monthName(m0)}どれだけ働いてよいか`));

  // --- まず大きく：上限・カレンダーから・あと ---
  addRow(box1, `${monthName(target)}収入の上限`, formatYen(result), "big must"); // 絶対に超えない上限なので赤
  addRow(box1, "カレンダーから", formatYen(calendarAll));
  if (tentativeAll !== 0) addRow(box1, "仮シフト", formatYen(tentativeAll));
  addRow(box1, "あと", formatYen(Math.max(0, remain)), remain < 0 ? "over" : "total strong");
  // 平均外のバイト先なら、3か月平均と予定金額は気にしなくてよいので、年の上限からだけで決まる
  //   平均外ならあと ＝ 年の上限から − カレンダーから − 仮シフト
  const outsideRemain = yearCap - calendarAll - tentativeAll;
  addRow(box1, "平均外ならあと", formatYen(Math.max(0, outsideRemain)), "dim");

  if (remain < 0) {
    box1.appendChild(el("p", "warn", `上限を${formatYen(-remain)}超えています。`));
  }
  if (cap.windowMin <= 0) {
    box1.appendChild(el("p", "warn", "ほかの月だけで、3か月平均が上限を超えてしまいます。"));
  }
  if (yearCap <= 0) {
    box1.appendChild(el("p", "warn", `ほかの月だけで、${year}年の合計が年の上限を超えてしまいます。`));
  }

  // --- 上限の決まり方（▶ を押すと開く） ---
  const howTo = rememberedDetails("how-to", "breakdown how-to");
  howTo.append(el("summary", "", "上限の決まり方"));

  // (1) 年の上限から：絶対に超えてはいけないので赤で書く
  const yearLabel = el("span");
  yearLabel.append(`${year}年の上限から`, el("br"), "（絶対に超えない）");
  addRow(howTo, yearLabel, formatYen(Math.max(0, yearCap)), "must");

  // 年の上限からの内訳（さらに ▶ を押すと開く）
  const details = rememberedDetails("year-breakdown", "breakdown");
  const usedRange = target.getMonth() === 0
    ? "まだなし（1月なので引く月がありません）"
    : `${year}年1月〜${monthName(addMonths(target, -1))}の合計 ${formatYen(otherMonths)}`;
  details.append(el("summary", "", `内訳：${usedRange}`));
  for (const b of yearBreakdown) {
    addRow(details, `${monthName(b.d)}（${b.source}）`, formatYen(b.value));
  }
  addRow(details, `${formatYen(yearLimit)} − ${formatYen(otherMonths)}`, formatYen(yearCap), "total");
  howTo.appendChild(details);

  // (2)(3) 3か月平均。対象の月で終わる3か月の平均から出した上限は、絶対に超えてはいけないので赤で書く
  for (const w of cap.windows) {
    const isMust = monthKey(w.months[2]) === monthKey(target);
    const label = el("span");
    label.append(rangeName(w.months));
    if (isMust) label.append(el("br"), "（絶対に超えない）"); // 改行してから書く
    addRow(howTo, label, formatYen(Math.max(0, w.cap)), isMust ? "must" : (w.cap === minAll ? "strong" : "dim"));
  }

  // (4) 予定金額
  addRow(howTo, `予定金額の${monthName(target)}`, cap.plan == null ? "未設定" : formatYen(cap.plan),
         cap.plan != null && cap.plan === minAll ? "strong" : "dim");
  box1.appendChild(howTo);

  container.appendChild(box1);
}
