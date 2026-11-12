// ===== 給料の計算 =====

// "17:30" → 1050（0時からの分数）
function toMinutes(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

// 0時からの分数 m が、夜間（nightStart〜nightEnd）に入っているか
// 例：22:00〜05:00 のように日付をまたぐ設定にも対応
function isNight(m, nightStart, nightEnd) {
  if (nightStart === nightEnd) return false;      // 同じ時刻なら夜間なし
  if (nightStart < nightEnd) return m >= nightStart && m < nightEnd;
  return m >= nightStart || m < nightEnd;
}

// 1回のシフトの給料を計算する（時給のバイト先）
// shift = {
//   start: "17:00", end: "22:30", breakMin: 30, wage: 1100,
//   nightStart: "22:00", nightEnd: "05:00", nightWage: 0（0なら wage と同じ＝1倍）,
//   overtimeAfterHours: 8, overtimeWage: 0（0なら wage と同じ＝1倍）
// }
// 戻り値: { pay: 給料, nightMin: 夜間に働いた分, overtimeMin: 残業した分 }
//
// 時給の決め方（1分ごと）：
//   基本の時給 ＋ 夜間なら（夜間の時給 − 基本）＋ 残業なら（残業の時給 − 基本）
//   → 夜間と残業が重なると、両方の上乗せ分を足す
function calcPayDetail(shift) {
  const start = toMinutes(shift.start);
  let end = toMinutes(shift.end);
  if (end <= start) end += 24 * 60; // 終了が開始より前なら日付またぎ

  const nightStart = toMinutes(shift.nightStart || "22:00");
  const nightEnd = toMinutes(shift.nightEnd || "05:00");
  // 夜間・残業の上乗せ分（0 なら基本と同じなので上乗せなし）
  const nightExtra = shift.nightWage > 0 ? shift.nightWage - shift.wage : 0;
  const overtimeExtra = shift.overtimeWage > 0 ? shift.overtimeWage - shift.wage : 0;
  const overtimeAfter = (shift.overtimeAfterHours ?? 8) * 60;

  // 1分ずつ「夜間かどうか」を並べる（C の配列と同じ）
  const minutes = [];
  for (let t = start; t < end; t++) minutes.push(isNight(t % (24 * 60), nightStart, nightEnd));

  // 休憩を取り除く：まず夜間でない時間から、足りなければ夜間から
  let breakLeft = shift.breakMin;
  for (const wantNight of [false, true]) {
    for (let i = 0; i < minutes.length && breakLeft > 0; i++) {
      if (minutes[i] === wantNight) {
        minutes[i] = null; // 休憩の印
        breakLeft--;
      }
    }
  }

  // 働いた分を前から数えて、overtimeAfter を超えた分が残業
  // 1分ごとに「時給」を足していき、最後にまとめて 60 で割る
  // （毎回 rate / 60 を足すと、小数の計算の誤差で1円ずれることがあるため）
  let total = 0;
  let worked = 0;
  let nightMin = 0;
  let overtimeMin = 0;
  for (const night of minutes) {
    if (night === null) continue; // 休憩
    worked++;
    const overtime = worked > overtimeAfter;
    let rate = shift.wage;
    if (night) { rate += nightExtra; nightMin++; }
    if (overtime) { rate += overtimeExtra; overtimeMin++; }
    total += rate;
  }
  const pay = Math.floor(total / 60 + 1e-9); // 1円未満は切り捨て（1e-9 は小数の誤差よけ）
  return { pay, nightMin, overtimeMin };
}

// 給料だけ欲しいとき
function calcPay(shift) {
  return calcPayDetail(shift).pay;
}

// Google カレンダーの予定をシフトに変換する。バイトの予定でなければ null を返す
// 戻り値の例: { place: "カフェ", payType: "hourly", pay: 5500, day: "2026-11-10",
//              month: "2026-11", workMin: 300, inAverage: true, ... }
//
// edit：その予定だけの設定（詳細画面で入力したもの）。なければ {}
//   { place: "カフェ" または "none"（バイトではない）,
//     role: 役職名 または "-"（役職なし）。なければ予定名から自動で判定,
//     breakMin: 30, bonus: 1000, bonusNote: "..." }
function eventToShift(event, workplaces, edit = {}) {
  if (!event.start.dateTime) return null; // 終日の予定はシフトではない
  if (edit.place === "none") return null; // 「バイトではない」と指定された

  // バイト先：指定があればそれ、なければ予定名から自動で探す
  let wp = null;
  if (edit.place) wp = workplaces.find(w => w.name === edit.place);
  if (!wp) wp = matchWorkplace(event, workplaces);
  if (!wp) return null;

  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);
  const spanMin = Math.round((end - start) / 60000); // ミリ秒 → 分（拘束時間）
  if (spanMin <= 0 || spanMin >= 24 * 60) return null;

  // 休憩：指定があればそれ、なければバイト先設定の「休憩 〇時間」
  const autoBreak = Math.round((wp.breakHours || 0) * 60);
  let breakMin = edit.breakMin ?? autoBreak; // ?? は「左が空（null か undefined）なら右を使う」
  breakMin = Math.min(Math.max(0, breakMin), spanMin);

  // 役職：指定があればそれ、なければ予定名から自動で探す
  const role = findRole(event, wp, edit.role);
  const workMin = spanMin - breakMin;

  let basePay;
  let nightMin = 0;
  let overtimeMin = 0;
  if (wp.payType === "daily") {
    basePay = wp.dailyPay; // 日給：時間に関係なく決まった金額
  } else {
    const wage = role && role.wage > 0 ? role.wage : wp.wage; // 役職の時給（なければ基本の時給）
    const hhmm = (d) => d.toTimeString().slice(0, 5);
    const detail = calcPayDetail({
      start: hhmm(start), end: hhmm(end), breakMin, wage,
      nightStart: wp.nightStart, nightEnd: wp.nightEnd, nightWage: wp.nightWage,
      overtimeAfterHours: wp.overtimeAfterHours, overtimeWage: wp.overtimeWage,
    });
    basePay = detail.pay;
    nightMin = detail.nightMin;
    overtimeMin = detail.overtimeMin;
  }

  // 手当：1回ごと ＋ 1時間ごと × 働いた時間
  // 役職のシフトは役職の手当、役職なしのシフトはバイト先の手当
  const src = role || wp;
  const allowance = (src.perShift || 0) + Math.floor((src.perHour || 0) * workMin / 60);
  const transport = wp.transport || 0; // 交通費（1回ごと）
  const bonus = edit.bonus || 0;

  return {
    place: wp.name,
    payType: wp.payType,
    role: role ? role.name : "",  // 役職名（なければ ""）
    basePay,             // 時給 or 日給の分（夜間・残業の割増を含む）
    nightMin,            // 夜間に働いた分
    overtimeMin,         // 残業した分
    allowance,           // 手当（役職の手当か、バイト先の手当）
    transport,           // 交通費
    bonus,               // ボーナス
    pay: basePay + allowance + transport + bonus, // 合計
    day: dateKey(start),
    month: monthKey(start),
    spanMin,             // 拘束時間（分）
    breakMin,            // 休憩（分）
    autoBreak,           // バイト先設定どおりの休憩（分）
    workMin,             // 実働（分）
    inAverage: wp.inAverage,
    payDate: dateKey(payDateFor(start, wp)), // 振込日 "2026-12-25"
  };
}

// バイト先 wp の中から、この予定の役職を探す。役職なしなら null
//   chosen："" や undefined なら予定名から自動、"-" なら役職なし、それ以外はその名前の役職
function findRole(event, wp, chosen) {
  const roles = (wp.roles || []).filter(r => r.name);
  if (chosen === "-") return null;
  if (chosen) return roles.find(r => r.name === chosen) || null;
  const title = event.summary || "";
  return roles.find(r => title.includes(r.name)) || null;
}

// 働いた日と、バイト先の支払いの設定から、振込日を計算する
// wp.payCycle："month"＝月払い、"week"＝週払い、"sameday"＝当日払い
function payDateFor(workDate, wp) {
  if (wp.payCycle === "sameday") {
    // 当日払い：働いた日
    return new Date(workDate.getFullYear(), workDate.getMonth(), workDate.getDate());
  }
  if (wp.payCycle === "week") {
    // 週払い（週は月曜〜日曜で数える）
    //   1. 働いた日から、締め曜日まで進める（締め日）
    //   2. 締め日がある週を「当週」として、weekPayOffset 週あと（0＝当週、1＝翌週、2＝翌々週）の支払い曜日
    //   3. それが締め日より前になったら（当週払いで曜日が早いとき）、1週あとにする
    // 例：日曜締め・翌週土曜払いなら、水曜に働いた分 → その週の日曜で締め → 次の週の土曜
    const close = new Date(workDate.getFullYear(), workDate.getMonth(), workDate.getDate());
    while (close.getDay() !== wp.weekCloseDay) close.setDate(close.getDate() + 1);

    const monday = new Date(close);
    monday.setDate(close.getDate() - ((close.getDay() + 6) % 7)); // 締め日がある週の月曜日
    const offset = wp.weekPayOffset ?? 1;
    const pay = new Date(monday);
    pay.setDate(monday.getDate() + 7 * offset + ((wp.weekPayDay + 6) % 7)); // 月曜から数えて何日目か
    if (pay < close) pay.setDate(pay.getDate() + 7);
    return pay;
  }
  return monthlyPayDate(workDate, wp);
}

// 月払いの振込日
// wp.closingDay：締め日（0 は末日）
// wp.payMonthOffset：締めた月の 0＝当月、1＝翌月、2＝翌々月 に払われる
// wp.payDay：給料日（0 は末日）
function monthlyPayDate(workDate, wp) {
  // どの月の締めに入るか：締め日を過ぎて働いた分は、次の月の締めに入る
  let closeMonth = workDate.getMonth();
  if (wp.closingDay > 0 && workDate.getDate() > wp.closingDay) closeMonth += 1;

  // 振込の月（その月の1日）
  const payMonth = new Date(workDate.getFullYear(), closeMonth + wp.payMonthOffset, 1);

  // 振込日：末日の指定、または31日のように月にない日は、その月の最後の日にする
  const lastDay = new Date(payMonth.getFullYear(), payMonth.getMonth() + 1, 0).getDate();
  const day = wp.payDay === 0 ? lastDay : Math.min(wp.payDay, lastDay);
  return new Date(payMonth.getFullYear(), payMonth.getMonth(), day);
}

// 予定名に「予定名」の文字が含まれているバイト先を探す。なければ undefined
function matchWorkplace(event, workplaces) {
  const title = event.summary || "";
  return workplaces.find(w => w.name && title.includes(w.name));
}
