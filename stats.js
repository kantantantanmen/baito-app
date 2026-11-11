// ===== 「集計」の画面：月平均の表と年合計（◯月の収入＝振り込まれる月で数える） =====

// 表の1行を作る。cells は [文字 or 部品, クラス名] の配列
function tableRow(cells, tag = "td") {
  const tr = el("tr");
  for (const [content, className] of cells) {
    const cell = el(tag, className || "");
    cell.append(content);
    tr.append(cell);
  }
  return tr;
}

// 月の金額の出どころを短い言葉にする
// バイト先が全部確定した月は「確定」（金額が0円でも）、一部だけ確定した月は「一部確定」
// 自動確定（カレンダーの額で自動で確定したもの）も、表示は「確定」にまとめる（見分けは収入確定の画面だけ）
//   今月の見込みがある →「見込み」（全部見込み）または「確定＋見込み」
function sourceText(x) {
  if (x.source === "plan") return "予定設定";
  if (x.hasConfirmed) {
    if (!x.allConfirmed) return "一部確定";
    if (x.expectCount > 0) return x.autoCount + x.manualCount === 0 ? "見込み" : "確定＋見込み";
    return "確定";
  }
  if (x.outsideOnly) return "平均外のみ"; // 平均外のバイト先のシフトだけ（平均の計算では0円）
  if (x.value === 0) return "―";
  return "カレンダー";
}

// 「2026年11月」、ただし年の途中の月は「12月」だけ
function tableMonthName(d, first) {
  return first || d.getMonth() === 0 ? `${d.getFullYear()}年${monthName(d)}` : monthName(d);
}

// ----- 集計の画面だけの切り替え（カレンダー優先／予定設定優先） -----
// 月平均の表の、来月から先でまだ全部は確定していない月に効く（年の表は両方の列が並んでいるので関係ない）
const STATS_PRIORITY_KEY = "baito-priority-main";

function loadStatsPriority() {
  return localStorage.getItem(STATS_PRIORITY_KEY) === "plan" ? "plan" : "calendar";
}

function saveStatsPriority(priority) {
  localStorage.setItem(STATS_PRIORITY_KEY, priority);
}

function statsPriorityToggle(priority, onChange) {
  const box = el("div", "priority");
  box.append(el("span", "priority-label", "月平均の表で、来月から先の月に使う額"));
  const group = el("div", "segmented");
  for (const [value, text] of [["calendar", "カレンダー優先"], ["plan", "予定設定優先"]]) {
    const button = el("button", value === priority ? "active" : "", text);
    button.onclick = () => {
      saveStatsPriority(value);
      onChange();
    };
    group.append(button);
  }
  const { button, text } = helpParts("help:stats-priority", [
    "カレンダー優先：カレンダー＋仮シフトから計算した額（確定したバイト先は確定額）。シフトがない月だけ予定設定の額。",
    "予定設定優先：予定設定に入力がある月はその額（一部確定していても）。入力がない月はカレンダー優先と同じ。",
    "今月までの月と全部確定した月は、どちらでも確定額（自動確定・見込みを含む）。",
  ]);
  const use = el("div", "help-head");
  use.append(el("p", "small priority-use",
    "カレンダー優先：今入れたシフトだと平均はどうなるか　／　予定設定優先：計画どおりに働いたら平均はどうなるか"), button);
  box.append(group, use, text);
  return box;
}

function renderStats(container, ctx) {
  const { income, plans, viewMonth } = ctx;
  const limit = loadLimit();
  const thisMonth = monthKey(new Date());
  const m0 = viewMonth;

  // 月の金額：今月までの月は確定額（自動確定・見込みを含む）。
  // 来月から先でまだ全部は確定していない月は、この画面の切り替えに従う
  //   カレンダー優先：カレンダー＋仮シフト（シフトがない月だけ予定設定）
  //   予定設定優先  ：予定設定に入力があればその額（なければカレンダー優先と同じ）
  const priority = loadStatsPriority();
  const infoOf = (d) => monthInfo(income, plans, monthKey(d), true, priority);
  const valueOf = (d) => infoOf(d).value;

  container.textContent = "";
  container.append(el("h2", "settings-title", "集計"), statsPriorityToggle(priority, ctx.onChange));

  // ---------- 月平均の表（表示中の月が入る平均だけ） ----------
  const avgSection = el("section", "settings-section");
  avgSection.append(
    titleWithHelp("h3", `${monthName(m0)}の収入が入る月平均`, [
      `${monthName(m0)}の収入が入っている3か月平均だけを出しています。上の ‹ › で月を切り替えられます。`,
      "今月までの月と全部確定した月は確定額（自動確定・見込みを含む）。来月から先の月は、上の切り替えで決まる額です。",
    ], "stats-avg"),
    el("p", "muted", `上限：月平均 ${formatYen(limit)}。赤い数字は上限超え、上限を超える3か月は赤い枠で囲みます。`),
  );

  const avgTable = el("table", "data-table");
  avgTable.append(tableRow(
    [["月"], ["収入", "num"], ["もと"], ["3か月平均", "num"]], "th"));

  // 平均のセル。window（平均する月）に表示中の月が入っていなければ「―」
  const avgCell = (months) => {
    if (!months.some(d => monthKey(d) === monthKey(m0))) return [el("span", "muted", "―"), "num"];
    const avg = months.reduce((s, d) => s + valueOf(d), 0) / months.length;
    const box = el("span");
    box.append(
      el("div", "", formatYen(avg)),
      el("div", "avg-range", `${months.map(monthName).join("・")}の平均`),
    );
    return [box, avg > limit ? "num over" : "num"];
  };

  const avgRows = []; // 赤い枠を付けるために、行と月を覚えておく
  for (let i = -2; i <= 2; i++) {
    const d = addMonths(m0, i);
    const x = infoOf(d);
    const tr = tableRow([
      [tableMonthName(d, i === -2)],
      [formatYen(x.value), "num"],
      [sourceText(x), "muted small"],
      avgCell([addMonths(d, -2), addMonths(d, -1), d]),
    ]);
    if (monthKey(d) === monthKey(m0)) tr.classList.add("now"); // 表示中の月の行に色を付ける
    avgTable.append(tr);
    avgRows.push({ tr, key: monthKey(d), month: d });
  }
  // 表示中の月が入る3か月平均（表示中の月〜2か月後で終わるもの）が上限を超えたら、その3か月を赤い枠で囲む
  markOverRows(avgRows, overLimitMonths([m0, addMonths(m0, 1), addMonths(m0, 2)], valueOf, limit));

  const avgWrap = el("div", "table-wrap");
  avgWrap.append(avgTable);
  avgSection.append(avgWrap);
  container.append(avgSection);

  // ---------- 年合計（3通り） ----------
  const year = viewMonth.getFullYear();
  const yearSection = el("section", "settings-section");
  yearSection.append(
    titleWithHelp("h3", `${year}年の収入（1〜12月に振り込まれる分）`, [
      "確定のみ：確定した金額だけ（自動確定・今月の見込みを含む）。",
      "カレンダー優先：確定したバイト先は確定額、ほかはカレンダー＋仮シフト（どちらもない月は予定設定）。",
      "予定設定優先：予定設定に入力がある月は一部確定していても予定設定、入力がない月はカレンダー優先と同じ。",
      "今月までの月と全部確定した月は、どちらでも確定額（自動確定・見込みを含む）。",
      "振り込まれた月で数えるので、税金の年収と同じ数え方です。",
    ], "stats-year"),
    el("p", "small priority-use",
      "カレンダー優先：今入れたシフトだと年の収入はどうなるか　／　予定設定優先：計画どおりに働いたら年の収入はどうなるか"),
  );

  const yearTable = el("table", "data-table");
  yearTable.append(tableRow(
    [["月"], ["確定のみ", "num"], ["カレンダー優先（＋仮シフト）", "num"], ["予定設定優先", "num"]], "th"));

  const sums = { confirmed: 0, calendar: 0, plan: 0 };
  for (let m = 0; m < 12; m++) {
    const key = monthKey(new Date(year, m, 1));
    const byCalendar = monthInfo(income, plans, key, false, "calendar");
    const byPlan = monthInfo(income, plans, key, false, "plan");
    sums.confirmed += byCalendar.confirmed;
    sums.calendar += byCalendar.value;
    sums.plan += byPlan.value;

    const tr = tableRow([
      [`${m + 1}月`],
      [formatYen(byCalendar.confirmed), "num"],
      [formatYen(byCalendar.value), "num"],
      [formatYen(byPlan.value), "num"],
    ]);
    if (key === thisMonth) tr.classList.add("now");
    yearTable.append(tr);
  }
  const totalRow = tableRow([
    ["合計"],
    [formatYen(sums.confirmed), "num"],
    [formatYen(sums.calendar), "num"],
    [formatYen(sums.plan), "num"],
  ]);
  totalRow.classList.add("total");
  yearTable.append(totalRow);

  const yearWrap = el("div", "table-wrap");
  yearWrap.append(yearTable);
  yearSection.append(yearWrap);
  container.append(yearSection);
}
