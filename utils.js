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
