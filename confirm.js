// ===== 「収入確定」の画面（◯月の収入＝振り込まれる月ごとに確定する） =====

// バイト先1件分のカード
// closed：この月の収入がもう増えないか。自分で確定できるのは、締まった月だけ
function confirmCard(month, r, closed, onChange) {
  const isExpected = r.expected;                        // 今月の見込み（まだ増える）
  const isConfirmed = r.confirmed !== null && !isExpected; // 自分で確定 or 自動確定
  const isAuto = isConfirmed && r.auto;
  const card = el("div", "wp-card");

  const head = el("div", "confirm-head");
  head.append(el("strong", "", r.place), badge(badgeKind(r)));
  card.append(head);

  if (r.count > 0) {
    card.append(el("p", "muted small",
      `${payDatesText(r.payDates)}予定 ・ ${shortDate(r.firstDay)}〜${shortDate(r.lastDay)}の勤務 ${r.count}回・${formatHours(r.minutes)}`));
  } else {
    card.append(el("p", "muted small", "カレンダーには、この月に振り込まれるシフトがありません。"));
  }
  // カレンダーからの額と、仮シフトの額は分けて出す（estimate は両方を足したもの）
  addRow(card, "カレンダーからの額", formatYen(r.estimate - r.tentative));
  if (r.tentativeCount > 0) {
    addRow(card, `仮シフト（${r.tentativeCount}回）`, formatYen(r.tentative));
  }

  // 今月の見込み：カレンダー＋仮シフトの額
  if (isExpected) {
    addRow(card, "見込みとして使う額", formatYen(r.confirmed), "total");
    card.append(el("p", "note",
      "まだ増えるので、カレンダー＋仮シフトの額を見込みとして使っています。増えなくなったら自動で確定します。"));
  }

  // まだ締まっていない月は、自分では確定できない（今月は見込み、先の月はカレンダーの額）
  if (!closed) {
    if (!isExpected) {
      card.append(el("p", "note",
        "まだ増えるので確定できません。増えなくなったら自動で確定します。"));
    }
    return card;
  }

  // 確定額の入力欄（締まった月だけ。最初は確定額が入っている）
  // 自動確定のものは、自分で確かめたら「この金額で確定」で自分の確定にできる
  // 締まった月は必ず確定なので、取り消しはない（金額を変えたいときは「金額を更新」）
  const amount = numberInput(r.confirmed ?? r.estimate, 0);
  const confirmButton = el("button", "primary", isConfirmed && !isAuto ? "金額を更新" : "この金額で確定");
  confirmButton.onclick = () => {
    setConfirmed(month, r.place, Number(amount.value) || 0);
    markManual(month, r.place); // 自分で確定したので「自動」ではなくなる
    onChange();
  };
  card.append(field("確定額", amount, "円", confirmButton));

  if (isAuto) {
    card.append(el("p", "note",
      "自動で確定しました。給与明細で確かめたら「この金額で確定」を押してください。"));
  }

  // カレンダーからの額と確定額がずれていたら差を表示する（見込みは上に出しているので出さない）
  if (isConfirmed && r.confirmed !== r.estimate) {
    const diff = r.confirmed - r.estimate;
    card.append(el("p", "note", `カレンダーからの額との差：${diff > 0 ? "+" : ""}${formatYen(diff)}`));
  }
  return card;
}

// 画面全体。income は incomeByMonth の結果
function renderConfirm(container, income, viewMonth, workplaces, onChange) {
  const month = monthKey(viewMonth);

  // カレンダーから出たもの ＋ 登録しているバイト先（シフトがなくても確定できるように）
  const rowsByPlace = {};
  for (const r of monthRows(income, month)) rowsByPlace[r.place] = r;
  for (const w of workplaces) {
    if (w.name && !rowsByPlace[w.name]) {
      rowsByPlace[w.name] = {
        place: w.name, estimate: 0, confirmed: null, auto: false, expected: false,
        tentative: 0, tentativeCount: 0, value: 0, count: 0, minutes: 0,
        payDate: null, firstDay: null, lastDay: null,
      };
    }
  }
  const rows = Object.values(rowsByPlace);

  container.textContent = "";
  container.append(
    titleWithHelp("h2", `${viewMonth.getFullYear()}年${monthName(viewMonth)}の収入確定`, [
      "確定した金額は、集計や上限の計算でカレンダーからの額の代わりに使われます。",
      "もう勤務が入らなくなった月は、カレンダーからの額で自動で確定します（「自動確定」。計算上は確定と同じ）。",
      "今月の収入でまだ増える分は、カレンダー＋仮シフトの額を「見込み」として使います。上の ‹ › で月を切り替えられます。",
    ], "confirm"),
    el("p", "muted intro",
      `${monthName(viewMonth)}に振り込まれる給料を、給与明細や通帳で確認したら確定してください。`),
  );

  if (rows.length === 0) {
    container.append(el("p", "note", "バイト先が登録されていません。先に「バイト先設定」で登録してください。"));
    return;
  }
  for (const r of rows) {
    const w = workplaces.find(x => x.name === r.place);
    const closed = w ? lastClosedMonth(w) >= month : true; // 消したバイト先の確定額は直せるようにしておく
    container.append(confirmCard(month, r, closed, onChange));
  }

  // 合計
  let confirmedSum = 0;
  let autoSum = 0;
  let expectSum = 0;
  let calendarSum = 0;
  for (const r of rows) {
    if (r.confirmed === null) calendarSum += r.estimate;
    else if (r.expected) expectSum += r.confirmed;
    else if (r.auto) autoSum += r.confirmed;
    else confirmedSum += r.confirmed;
  }
  const total = el("div", "wp-card");
  addRow(total, "確定", formatYen(confirmedSum));
  addRow(total, "自動確定（カレンダーから）", formatYen(autoSum));
  if (expectSum > 0) addRow(total, "見込み", formatYen(expectSum));
  addRow(total, "未確定（カレンダー＋仮シフト）", formatYen(calendarSum));
  addRow(total, `${monthName(viewMonth)}の収入 合計`,
         formatYen(confirmedSum + autoSum + expectSum + calendarSum), "total big");
  container.append(total);
}
