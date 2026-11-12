// ===== 「シフト時間設定」の画面 =====
// シフトを追加するときに最初から入れておく時間を、バイト先ごと・曜日ごとに決めておく
// 時給のバイト先だけ。時間1・時間2…と何回分でも決められる
// 決めていない曜日（と日給のバイト先）は、前回そのバイト先で入れた時間を使う

// 形: { "カフェ": { "1": [{ start: "10:00", end: "13:00" }, { start: "17:00", end: "21:00" }], "6": [...] } }
//   キーの数字は曜日（Date の getDay() と同じ。日曜 = 0）
const SHIFT_TIMES_KEY = "baito-shift-times";

function loadShiftTimes() {
  try {
    return JSON.parse(localStorage.getItem(SHIFT_TIMES_KEY)) || {};
  } catch {
    return {};
  }
}

function saveShiftTimes(all) {
  localStorage.setItem(SHIFT_TIMES_KEY, JSON.stringify(all));
}

// そのバイト先・その日の曜日に決めてある時間 → [{ start, end }, ...]（決めていなければ []）
function defaultTimesFor(place, day) {
  if (!place || !day) return [];
  const list = (loadShiftTimes()[place] || {})[String(parseDate(day).getDay())] || [];
  return list.filter(t => t.start && t.end);
}

// バイト先の名前を変えたとき、決めてある時間も新しい名前に付け替える（settings.js から呼ぶ）
function renameShiftTimes(oldName, newName) {
  const all = loadShiftTimes();
  if (!(oldName in all)) return;
  if (!(newName in all)) all[newName] = all[oldName];
  delete all[oldName];
  saveShiftTimes(all);
}

// 画面を作る
function renderShiftTimes(container) {
  // 時給のバイト先だけ出す（日給は時間で給料が変わらないため）
  const workplaces = loadWorkplaces().filter(w => w.name && w.payType !== "daily");
  const all = loadShiftTimes();
  const rerender = () => renderShiftTimes(container);

  container.textContent = "";
  container.append(titleWithHelp("h2", "シフト時間設定", [
    "シフトや仮シフトを追加するとき、最初から入っている時間を、時給のバイト先ごと・曜日ごとに決められます。",
    "「＋ 時間」で、1日に2回・3回のシフトの時間も決められます（追加の画面で時間1・時間2…として入ります）。",
    "空いている曜日と日給のバイト先は、前回そのバイト先で入れた時間が入ります。",
  ], "shift-times"));

  if (workplaces.length === 0) {
    container.append(el("p", "note", "時給のバイト先が登録されていません。「バイト先設定」で登録すると、ここで時間を決められます。"));
    return;
  }

  for (const wp of workplaces) {
    const card = el("div", "wp-card times-card");
    card.append(el("h3", "times-place", wp.name));
    const byDay = all[wp.name] || (all[wp.name] = {});

    // 月曜から日曜の順に1行ずつ
    for (const wd of [1, 2, 3, 4, 5, 6, 0]) {
      const key = String(wd);
      const times = byDay[key] || [];
      const row = el("div", `times-day${wd === 6 ? " sat" : wd === 0 ? " sun" : ""}`);
      row.append(el("span", "times-weekday", "日月火水木金土"[wd]));
      const lines = el("div", "times-lines");

      // ＋ 時間（その曜日に何か時間が入っているときだけ出す）
      const add = el("button", "add-time", "＋ 時間");
      add.type = "button";
      add.onclick = () => {
        byDay[key] = [...(byDay[key] || []), { start: "", end: "" }];
        saveShiftTimes(all);
        rerender();
      };
      const dels = [];
      // × と「＋ 時間」を出すか決める（入力の途中で画面を作り直すと、選んでいる途中の欄が消えてしまうので、隠す・出すだけにする）
      const refreshButtons = () => {
        const has = (byDay[key] || []).some(x => x.start || x.end);
        add.hidden = !has;
        for (const d of dels) d.hidden = !has;
      };

      // 時間の行（入れていなくても1行は出す）
      const shown = times.length > 0 ? times : [{ start: "", end: "" }];
      shown.forEach((t, j) => {
        const line = el("div", "time-row-inline");
        const s = timeInput(t.start);
        const e = timeInput(t.end);
        const save = () => {
          const list = [...(byDay[key] || [])];
          list[j] = { start: s.value, end: e.value };
          byDay[key] = list;
          if (list.every(x => !x.start && !x.end)) delete byDay[key];
          saveShiftTimes(all);
          refreshButtons();
        };
        s.onchange = save;
        e.onchange = save;
        line.append(s, "〜", e);
        // × ：この時間を消す
        const del = el("button", "icon-btn remove-time", "×");
        del.type = "button";
        del.setAttribute("aria-label", "この時間を消す");
        del.onclick = () => {
          byDay[key] = (byDay[key] || []).filter((_, k) => k !== j);
          if (byDay[key].length === 0) delete byDay[key];
          saveShiftTimes(all);
          rerender();
        };
        dels.push(del);
        line.append(del);
        lines.append(line);
      });
      lines.append(add);
      refreshButtons();
      row.append(lines);
      card.append(row);
    }

    // 月曜の時間を、ほかの曜日（火〜日）全部にも入れる
    const copy = el("button", "", "月曜と同じ時間をすべての曜日に入れる");
    copy.type = "button";
    copy.className = "times-copy";
    copy.onclick = () => {
      const mon = byDay["1"];
      if (!mon || mon.length === 0) {
        alert("先に月曜の時間を入れてください。");
        return;
      }
      for (const wd of ["2", "3", "4", "5", "6", "0"]) byDay[wd] = mon.map(t => ({ ...t }));
      saveShiftTimes(all);
      rerender();
    };
    card.append(copy);
    container.append(card);
  }
}
