// ===== どのファイルからも使う小道具 =====

// Date → "2026-11-08"
function dateKey(d) {
  return d.toLocaleDateString("sv-SE");
}

// Date → "2026-11"
function monthKey(d) {
  return dateKey(d).slice(0, 7);
}

// "2026-11-08" → Date（その日の0:00）
function parseDate(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// d の月から n か月ずらした月の1日（n がマイナスなら前の月）
function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

// Date → "11月"
function monthName(d) {
  return `${d.getMonth() + 1}月`;
}

// 12345 → "12,345円"
function formatYen(n) {
  return `${Math.round(n).toLocaleString()}円`;
}

// 330 → "5時間30分"
function formatHours(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}分`;
  return m ? `${h}時間${m}分` : `${h}時間`;
}

// "2026-12-25" → "12/25"
function shortDate(key) {
  const [, m, d] = key.split("-").map(Number);
  return `${m}/${d}`;
}

// 振込日の一覧を短い文字にする。1回なら「12/25振込」、何回もあれば「4回振込（〜12/26）」
function payDatesText(payDates) {
  if (!payDates || payDates.length === 0) return "";
  if (payDates.length === 1) return `${shortDate(payDates[0])}振込`;
  const last = [...payDates].sort()[payDates.length - 1];
  return `${payDates.length}回振込（〜${shortDate(last)}）`;
}

// 時刻の入力欄（5分単位）
// iPhone の時刻の入力欄は1分きざみでしか選べないので、「時」と「分」の2つの選択欄にする
// 分は 00・05・10…55 だけ。ふつうの入力欄と同じように .value（"17:05" か ""）・.disabled が使え、
// 選ぶと input・change が起きる（中の選択欄の知らせが外まで伝わる）
function timeInput(value) {
  const box = el("span", "time-select");
  const pad = (n) => String(n).padStart(2, "0");
  const hour = el("select");
  hour.append(option("", "--"));
  for (let h = 0; h < 24; h++) hour.append(option(pad(h), pad(h)));
  const minute = el("select");
  minute.append(option("", "--"));
  for (let m = 0; m < 60; m += 5) minute.append(option(pad(m), pad(m)));
  hour.setAttribute("aria-label", "時");
  minute.setAttribute("aria-label", "分");
  box.append(hour, el("span", "time-colon", ":"), minute);

  // 時を選んで分が空なら「00」にする（外に知らせが伝わる前に入れておく）
  for (const type of ["input", "change"]) {
    hour.addEventListener(type, () => { if (hour.value && !minute.value) minute.value = "00"; });
  }

  Object.defineProperty(box, "value", {
    get: () => (hour.value && minute.value ? `${hour.value}:${minute.value}` : ""),
    set: (v) => {
      const [h, m] = v ? String(v).slice(0, 5).split(":") : ["", ""];
      hour.value = h || "";
      // Google カレンダーの予定が 10:03 のように5分きざみでないときは、その分も選べるようにする
      if (m && ![...minute.options].some(o => o.value === m)) {
        const after = [...minute.options].find(o => o.value > m);
        minute.insertBefore(option(m, m), after || null);
      }
      minute.value = m || "";
    },
  });
  Object.defineProperty(box, "disabled", {
    get: () => hour.disabled,
    set: (d) => { hour.disabled = minute.disabled = !!d; },
  });
  box.value = value;
  return box;
}

// 選択肢（<option>）を作る
function option(value, text) {
  const o = el("option", "", text);
  o.value = value;
  return o;
}

// 選択欄（<select>）を作る。choices は [[値, 表示する文字], ...]
function selectInput(choices, value) {
  const s = el("select");
  for (const [v, text] of choices) s.append(option(String(v), text));
  s.value = String(value);
  return s;
}

// 表の行のうち、3か月平均が上限を超える期間を赤い枠で囲む
// rows: [{ tr, key }]（月の順）、overKeys: 超えている期間に入る月のキーの Set
// 続いている行はまとめて1つの枠にする（最初の行に上の線、最後の行に下の線）
function markOverRows(rows, overKeys) {
  rows.forEach((r, i) => {
    const on = overKeys.has(r.key);
    const prevOn = i > 0 && overKeys.has(rows[i - 1].key);
    const nextOn = i < rows.length - 1 && overKeys.has(rows[i + 1].key);
    r.tr.classList.toggle("ow", on);
    r.tr.classList.toggle("ow-top", on && !prevOn);
    r.tr.classList.toggle("ow-bottom", on && !nextOn);
  });
}

// 画面の部品を作る近道： el("div", "クラス名", "中の文字")
function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// 平均する3か月を「10〜12月」のように短く書く（年をまたぐときは「11〜1月」）
function monthRangeText(first, last) {
  return `${first.getMonth() + 1}〜${last.getMonth() + 1}月`;
}

// ===== 日本の祝日（今の法律のきまりで計算する。カレンダーの背景の色に使う） =====
const holidayCache = {};

// その年の祝日 → { "2026-01-01": true, ... }（振替休日・国民の休日も入る）
function holidaysOf(year) {
  if (holidayCache[year]) return holidayCache[year];
  const days = new Set();
  const add = (m, d) => days.add(dateKey(new Date(year, m - 1, d)));
  // m月の n 回目の月曜日
  const nthMonday = (m, n) => {
    const first = new Date(year, m - 1, 1).getDay();
    add(m, 1 + ((8 - first) % 7) + (n - 1) * 7);
  };
  const y = year - 1980;
  add(1, 1);                                                          // 元日
  nthMonday(1, 2);                                                    // 成人の日
  add(2, 11);                                                         // 建国記念の日
  add(2, 23);                                                         // 天皇誕生日
  add(3, Math.floor(20.8431 + 0.242194 * y - Math.floor(y / 4)));    // 春分の日
  add(4, 29);                                                         // 昭和の日
  add(5, 3); add(5, 4); add(5, 5);                                    // 憲法記念日・みどりの日・こどもの日
  nthMonday(7, 3);                                                    // 海の日
  add(8, 11);                                                         // 山の日
  nthMonday(9, 3);                                                    // 敬老の日
  add(9, Math.floor(23.2488 + 0.242194 * y - Math.floor(y / 4)));    // 秋分の日
  nthMonday(10, 2);                                                   // スポーツの日
  add(11, 3);                                                         // 文化の日
  add(11, 23);                                                        // 勤労感謝の日

  const base = [...days].sort();
  // 国民の休日：祝日と祝日にはさまれた平日（9月の敬老の日と秋分の日の間など）
  for (const key of base) {
    const d = parseDate(key);
    d.setDate(d.getDate() + 2);
    const mid = new Date(d);
    mid.setDate(mid.getDate() - 1);
    if (days.has(dateKey(d)) && !days.has(dateKey(mid)) && mid.getDay() !== 0) days.add(dateKey(mid));
  }
  // 振替休日：日曜日の祝日のあと、最初の祝日でない日
  for (const key of base) {
    const d = parseDate(key);
    if (d.getDay() !== 0) continue;
    do d.setDate(d.getDate() + 1); while (days.has(dateKey(d)));
    days.add(dateKey(d));
  }
  return (holidayCache[year] = days);
}

// "2026-11-03" が祝日か
function isHoliday(key) {
  return holidaysOf(Number(key.slice(0, 4))).has(key);
}

// ===== 「？」を押すと出る説明 =====
// 開いている説明を覚えておく（画面が作り直されても閉じないように）。key は説明ごとの名前
const openedHelps = new Set();

// 「？」ボタンと、押すと出る説明の欄を作る → { button, text }
// lines：説明の文（1つでも、配列で何段落でもよい）
function helpParts(key, lines) {
  const button = el("button", "help-btn", "？");
  button.type = "button";
  button.title = "説明を見る";
  const text = el("div", "help-text");
  for (const line of [].concat(lines)) text.append(el("p", "", line));
  const show = (open) => {
    text.hidden = !open;
    button.classList.toggle("open", open);
    if (open) openedHelps.add(key);
    else openedHelps.delete(key);
  };
  show(openedHelps.has(key));
  button.onclick = () => show(text.hidden);
  return { button, text };
}

// 見出し＋「？」。押すと見出しの下に説明が出る。見出しと説明をまとめて返す
//   例：container.append(titleWithHelp("h3", "月平均", ["説明1", "説明2"]))
//   key：開いた状態を覚える名前（見出しに月の名前などが入って変わるときに渡す）
function titleWithHelp(tag, title, lines, key = title) {
  const { button, text } = helpParts(`help:${key}`, lines);
  const head = el("div", "help-head");
  head.append(el(tag, tag === "h2" ? "settings-title" : "", title), button); // h2 は画面の見出し
  const box = document.createDocumentFragment();
  box.append(head, text);
  return box;
}
