// ===== Google カレンダーのシフトの形：終日の予定 ＋ メモに時間 =====
// 1日・1つのバイト先につき、Google カレンダーには終日の予定を1つだけ作り、
// 働く時間はメモ（予定の説明）の後ろに1行ずつ「17:00〜22:00」と書く（1つの時間のあとに改行）
//   例：メモ「制服を持っていく\n17:00〜20:00\n21:00〜23:00\n」
// メモにもともと書いてあった文は残し、時間の行はその後ろに付け足す
// 読み込むときは、メモの時間の行1つずつを、アプリの中だけで時間つきの予定として扱う
// （給料の計算・カレンダーの表示・重なりの判定などは、今までの時間つきの予定と同じしくみで動く）
// 前の形（時間つきの予定）もそのまま読める。アプリで直したときや「書き直す」を押したときに、新しい形にする

// メモの中の時間の行（前後の空白は無視。〜 のほか ~ や - でもよい）
const TIME_LINE_RE = /^(\d{1,2}):(\d{2})\s*[〜~～\-－ー–—]\s*(\d{1,2}):(\d{2})$/;

// メモの中身を、ただの文字にする（Google カレンダーの画面で書いたメモは HTML のことがある）
function memoText(desc) {
  if (!desc) return "";
  if (!/<[a-z!/][\s\S]*>/i.test(desc)) return desc.replace(/\r\n?/g, "\n");
  const withBreaks = desc
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n");
  const doc = new DOMParser().parseFromString(withBreaks, "text/html");
  return (doc.body.textContent || "").replace(/ /g, " ");
}

// "9:00" → "09:00"
function padTime(h, m) {
  return `${String(Number(h)).padStart(2, "0")}:${m}`;
}

// 同じ時間は1つだけにして、早い順に並べる
function uniqueTimes(times) {
  const seen = new Map();
  for (const t of times) seen.set(`${t.start}|${t.end}`, t);
  return [...seen.values()].sort((a, b) => a.start.localeCompare(b.start));
}

// メモから時間の行を読み取る → [{ start: "17:00", end: "22:00" }, ...]（早い順。同じ時間が2行あれば1つ）
function parseTimeLines(desc) {
  const times = [];
  for (const line of memoText(desc).split("\n")) {
    const m = line.trim().match(TIME_LINE_RE);
    if (!m) continue;
    const start = padTime(m[1], m[2]);
    const end = padTime(m[3], m[4]);
    if (start === end) continue;
    times.push({ start, end });
  }
  return uniqueTimes(times);
}

// メモのうち、時間の行ではない文（前後の空行は除く）
function memoWithoutTimes(desc) {
  return memoText(desc)
    .split("\n")
    .filter(line => !TIME_LINE_RE.test(line.trim()))
    .join("\n")
    .trim();
}

// 書き込むメモを作る：もとの文（時間の行は除く）の後ろに、時間を1行ずつ（1つの時間のあとに改行）
function buildMemo(keepText, times) {
  const timesText = uniqueTimes(times) // 同じ時間は1回だけ書く（途中で閉じて、やり直したときなど）
    .map(t => `${t.start}〜${t.end}\n`)
    .join("");
  return keepText ? `${keepText}\n${timesText}` : timesText;
}

// 終日の予定の日付（その日1日だけ）
function allDayRange(day) {
  const next = parseDate(day);
  next.setDate(next.getDate() + 1);
  return { start: { date: day }, end: { date: dateKey(next) } };
}

// 読み込んだ予定 [{ event, cal }] のうち、メモに時間の行がある終日の予定を、時間の行ごとに分ける
// 分けたものは { event: 時間つきにした予定（id は元と同じ）, cal, base: 元の終日の予定, lineIndex: 何行目か }
function expandMemoShifts(list) {
  const out = [];
  for (const item of list) {
    const ev = item.event;
    const times = ev.start && ev.start.date ? parseTimeLines(ev.description) : [];
    if (times.length === 0) {
      out.push(item);
      continue;
    }
    times.forEach((t, i) => {
      out.push({
        event: { ...ev, ...eventTimes(ev.start.date, t.start, t.end) },
        cal: item.cal,
        base: ev,
        lineIndex: i,
      });
    });
  }
  return out;
}

// 予定ごとの設定（休憩・ボーナスなど）をまとめる（いくつかの予定を1つにまとめるとき）
// バイト先・役職・休憩は最初のもの、ボーナスは足し、メモはつなげる
function mergeEdits(list) {
  const edits = list.filter(e => e && Object.keys(e).length > 0);
  if (edits.length === 0) return {};
  const merged = { ...edits[0] };
  const bonus = edits.reduce((s, e) => s + (Number(e.bonus) || 0), 0);
  if (bonus > 0) merged.bonus = bonus;
  const notes = [...new Set(edits.map(e => e.bonusNote).filter(Boolean))];
  if (notes.length > 0) merged.bonusNote = notes.join("、");
  return merged;
}

// 1日・1つのバイト先のシフトを、終日の予定1つとして Google カレンダーに書く
//   cal     : 書くカレンダー
//   day     : "2026-11-20"
//   summary : 予定名（新しく作るときに使う）
//   times   : [{ start, end }]（メモに書く時間。全部）
//   target  : 書き換える終日の予定（なければ新しく作る）
//   others  : まとめて消す予定（前の形の時間つきの予定や、同じ日のほかの終日の予定）。メモの文は引き継ぐ
//   edit    : この予定の設定（休憩・ボーナスなど）。undefined なら設定は変えない
// 書いてから消す（途中で失敗しても、シフトが消えてなくならないように）
async function writeDayShift({ cal, day, summary, times, target = null, others = [], edit }) {
  const otherEvents = [];
  const seen = new Set(target ? [target.id] : []);
  for (const ev of others) {
    if (ev && !seen.has(ev.id)) {
      seen.add(ev.id);
      otherEvents.push(ev);
    }
  }
  // メモの文：書き換える予定のものと、まとめて消す予定のもの（同じ文は1つだけ）
  const texts = [target, ...otherEvents].filter(Boolean).map(ev => memoWithoutTimes(ev.description)).filter(Boolean);
  const description = buildMemo([...new Set(texts)].join("\n"), times);

  const written = target
    ? await updateEvent(cal.id, target.id, { ...allDayRange(day), description })
    : await createEvent(cal.id, { summary, ...allDayRange(day), description });
  putEventLocally(cal, written);

  const all = loadEdits();
  const newKey = `${cal.id}|${written.id}`;
  if (edit !== undefined) {
    if (Object.keys(edit).length > 0) all[newKey] = edit;
    else delete all[newKey];
  }
  for (const ev of otherEvents) delete all[`${cal.id}|${ev.id}`];
  saveEdits(all);

  for (const ev of otherEvents) {
    await deleteEvent(cal.id, ev.id);
    removeEventLocally(cal.id, ev.id);
  }
  return written;
}

// ===== 前の形（時間つき）のシフトを、新しい形に書き直す =====
// 書き込めるカレンダーにある、時間つきのシフトの予定（バイト先に当てはまるもの）
function oldStyleShifts(list) {
  const writable = (cal) => cal.accessRole === "owner" || cal.accessRole === "writer";
  return list.filter(x => x.shift && !x.base && !x.tentative && x.event.start.dateTime && writable(x.cal));
}

// 同じカレンダー・同じ日・同じバイト先（と役職）ごとに、終日の予定1つにまとめ直す
// 同じ日にもう新しい形の予定があれば、そこに時間を足す
async function convertOldShifts(list, allItems) {
  const groups = new Map();
  for (const x of oldStyleShifts(list)) {
    const key = `${x.cal.id}|${x.shift.day}|${x.shift.place}|${x.shift.role || ""}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(x);
  }
  const edits = loadEdits();
  const hhmm = (d) => d.toTimeString().slice(0, 5);
  let failed = 0;
  // 1日分ずつ書き直す。早く終わるように、4日分ずつ同時に進める（日ごとに書く予定が別なので、ぶつからない）
  const queue = [...groups.values()];
  const worker = async () => {
    for (let group = queue.shift(); group; group = queue.shift()) await convertGroup(group);
  };
  const convertGroup = async (group) => {
    const first = group[0];
    const day = first.shift.day;
    // 同じ日・同じバイト先の、新しい形の予定（あればそこに足す）
    const existing = allItems.find(x => x.base && x.cal.id === first.cal.id && x.shift &&
      x.shift.day === day && x.shift.place === first.shift.place && (x.shift.role || "") === (first.shift.role || ""));
    const target = existing ? existing.base : null;
    const times = [
      ...(target ? parseTimeLines(target.description) : []),
      ...group.map(x => ({ start: hhmm(new Date(x.event.start.dateTime)), end: hhmm(new Date(x.event.end.dateTime)) })),
    ];
    const edit = mergeEdits([
      ...(target ? [edits[`${first.cal.id}|${target.id}`]] : []),
      ...group.map(x => edits[editKey(x)]),
    ]);
    try {
      await writeDayShift({ cal: first.cal, day, summary: first.event.summary, times, target,
                            others: group.map(x => x.event), edit });
    } catch (err) {
      console.error(err);
      failed++;
    }
  };
  await Promise.all([1, 2, 3, 4].map(worker));
  return { groups: groups.size, failed };
}
