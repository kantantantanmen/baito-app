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
// iPhone の時刻の入力欄は1分きざみでしか選べないので、自分で作った選ぶ画面を使う
// 欄を押すと、「時」と「分（00・05…55）」の2本のくるくるが並んだ小さい画面が出て、「完了」で決まる
// ふつうの入力欄と同じように .value（"17:05" か ""）・.disabled が使え、決めると input・change が起きる
function timeInput(value) {
  const b = el("button", "time-select");
  b.type = "button"; // フォームの送信ボタンにしない
  b.setAttribute("aria-label", "時刻");
  let current = "";
  Object.defineProperty(b, "value", {
    get: () => current,
    set: (v) => {
      current = v ? String(v).slice(0, 5) : "";
      b.textContent = current || "--:--";
    },
  });
  b.value = value;
  b.addEventListener("click", () => {
    if (b.disabled) return;
    openTimePicker(b.value, (picked) => {
      if (picked === b.value) return;
      b.value = picked;
      b.dispatchEvent(new Event("input", { bubbles: true }));
      b.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
  return b;
}

// ===== 「＋ 時間」で足す時間を決める（シフトの追加・編集の画面で使う） =====
// current：今入っている時間 [{ start, end }]、defaults：シフト時間設定のその曜日の時間
// ・シフト時間設定の時間のうち、まだ入っていなくて、今の時間と重ならないものがあれば、それ（早いほうから）
// ・なければ、押したシフト（after。なければ一番遅い時間）の終わりの1時間後から2時間
//   （例：20:15 に終わるシフトなら 21:15〜23:15、12:30 なら 13:30〜15:30）
// ・それも今の時間と重なるなら、重なった時間の終わりの1時間後から2時間…と、重ならなくなるまでずらす
// ・夜中の0時より後に始まってしまうときは空
function nextTimeRange(current, defaults, after) {
  const toMin = (v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
  const toText = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  // 時間 → 分の範囲（終わりが始まり以前なら次の日に終わる）
  const range = (t) => {
    const s = toMin(t.start);
    let e = toMin(t.end);
    if (e <= s) e += 24 * 60;
    return { s, e };
  };
  const filled = current.filter(t => t.start && t.end);
  const ranges = filled.map(range);
  const overlapping = (r) => ranges.find(x => r.s < x.e && x.s < r.e);

  const missing = defaults.filter(d =>
    !filled.some(t => t.start === d.start && t.end === d.end) && !overlapping(range(d)));
  if (missing.length > 0) return { ...missing[0] };
  if (filled.length === 0) return { start: "", end: "" };

  const base = after && after.start && after.end
    ? after
    : [...filled].sort((a, b) => a.start.localeCompare(b.start))[filled.length - 1];
  let from = range(base).e + 60;
  for (;;) {
    if (from >= 24 * 60) return { start: "", end: "" };
    const hit = overlapping({ s: from, e: from + 120 });
    if (!hit) break;
    from = hit.e + 60; // 重なった時間の終わりの1時間後にずらす
  }
  return { start: toText(from), end: toText((from + 120) % (24 * 60)) };
}

// 時間の欄を早い順に並べ直す（早い時間が時間1になる）。pairs：[{ start: 時刻の欄, end: 時刻の欄 }]
// 空の時間は後ろに回す
function sortTimeInputs(pairs) {
  const values = pairs.map(p => ({ start: p.start.value, end: p.end.value }));
  values.sort((a, b) => (a.start || "99").localeCompare(b.start || "99"));
  pairs.forEach((p, i) => {
    p.start.value = values[i].start;
    p.end.value = values[i].end;
  });
}

// 時刻を選ぶ画面（「時」と「分」の2本のくるくる）。onDone(時刻) は「完了」を押したとき
const WHEEL_ITEM = 40; // くるくるの1段の高さ（px）
function openTimePicker(value, onDone) {
  const pad = (n) => String(n).padStart(2, "0");
  // 空のときは 12:00 から始める
  const [h0, m0] = (value || "12:00").split(":");
  const hours = Array.from({ length: 24 }, (_, i) => pad(i));
  const minutes = Array.from({ length: 12 }, (_, i) => pad(i * 5));
  // Google カレンダーの予定が 10:03 のように5分きざみでないときは、その分も並べる
  if (!minutes.includes(m0)) {
    minutes.push(m0);
    minutes.sort();
  }

  const picker = el("dialog", "time-picker");
  const head = el("div", "tp-head");
  const cancel = el("button", "tp-cancel", "やめる");
  const done = el("button", "tp-done", "完了");
  cancel.type = done.type = "button";
  head.append(cancel, done);

  const wheels = el("div", "tp-wheels");
  wheels.append(el("div", "tp-band")); // 真ん中の選んでいる段の色
  const makeWheel = (list, selected) => {
    const col = el("div", "tp-col");
    col.append(el("div", "tp-spacer"));
    list.forEach((v, i) => {
      const item = el("div", "tp-item", v);
      item.onclick = () => col.scrollTo({ top: i * WHEEL_ITEM, behavior: "smooth" });
      col.append(item);
    });
    col.append(el("div", "tp-spacer"));
    const index = () => Math.min(list.length - 1, Math.max(0, Math.round(col.scrollTop / WHEEL_ITEM)));
    return { col, start: Math.max(0, list.indexOf(selected)), get: () => list[index()] };
  };
  const hw = makeWheel(hours, h0);
  const mw = makeWheel(minutes, m0);
  wheels.append(hw.col, el("div", "tp-colon", ":"), mw.col);
  picker.append(head, wheels);

  const close = () => {
    picker.close();
    picker.remove();
  };
  cancel.onclick = close;
  done.onclick = () => {
    const picked = `${hw.get()}:${mw.get()}`;
    close();
    onDone(picked);
  };
  // 外側（暗い部分）を押したら、やめる
  picker.addEventListener("click", (e) => { if (e.target === picker) close(); });
  // くるくる以外（見出し・「:」・外側）を指で動かしても、後ろの画面は動かさない
  picker.addEventListener("touchmove", (e) => {
    if (!e.target.closest(".tp-col")) e.preventDefault();
  }, { passive: false });
  picker.addEventListener("cancel", (e) => { e.preventDefault(); close(); });

  document.body.append(picker);
  picker.showModal(); // シフトの画面の上に重ねて出す
  hw.col.scrollTop = hw.start * WHEEL_ITEM;
  mw.col.scrollTop = mw.start * WHEEL_ITEM;
  done.focus();
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
