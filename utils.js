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

// 時刻の入力欄
function timeInput(value) {
  const input = el("input");
  input.type = "time";
  input.value = value;
  return input;
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
