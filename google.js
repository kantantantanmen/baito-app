// ===== Google とのやりとり =====

// Google Cloud で作った「クライアントID」をここに貼る（秘密の情報ではないので、コードに書いて大丈夫）
const CLIENT_ID = "373422994052-el4vfksiins2vt90v354msu054t5gbfh.apps.googleusercontent.com";

// Google にお願いする許可（スペース区切りで複数）
//  ・calendar.readonly：カレンダーの一覧と予定を読む
//  ・calendar.events  ：予定を作る（シフトの追加に使う）
const SCOPE = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

const TOKEN_KEY = "baito-token";        // 通行証の保存名
const HINT_KEY = "baito-login-account"; // 前回ログインしたアカウントの保存名

let accessToken = null; // ログインすると Google からもらえる「通行証」（1時間有効）
let tokenClient = null;

// ログインの準備。ログインが終わったら onLogin を呼ぶ
function initGoogle(onLogin) {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: (response) => {
      if (response.error) {
        alert("ログインに失敗しました: " + response.error);
        return;
      }
      accessToken = response.access_token;
      saveToken(response.access_token, response.expires_in);
      onLogin();
    },
  });

  // 前回の通行証がまだ有効なら、ログインせずにそのまま始める
  const saved = loadToken();
  if (saved) {
    accessToken = saved;
    onLogin();
  }
}

// ===== 通行証の保存 =====

// 有効期限（秒）から「何時に切れるか」を計算して保存する。どの許可でもらったかも一緒に
function saveToken(token, expiresInSec) {
  const expiresAt = Date.now() + (Number(expiresInSec) - 60) * 1000; // 念のため1分早めに切れる扱い
  localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiresAt, scope: SCOPE }));
}

// 保存された通行証を返す。期限切れ・保存なし・許可の範囲が今と違うときは null
function loadToken() {
  try {
    const saved = JSON.parse(localStorage.getItem(TOKEN_KEY));
    if (saved && saved.expiresAt > Date.now() && saved.scope === SCOPE) return saved.token;
  } catch {}
  return null;
}

// 通行証が使えなくなったときに呼ぶ関数（app.js が入れる。ログインのボタンをまた出すため）
let onTokenLost = () => {};

function clearToken() {
  accessToken = null;
  localStorage.removeItem(TOKEN_KEY);
  onTokenLost();
}

// 次回のログインを簡単にするため、ログインしたアカウントを覚えておく
function rememberAccount(email) {
  localStorage.setItem(HINT_KEY, email);
}

// ログイン画面を出す
function login() {
  const account = localStorage.getItem(HINT_KEY);
  if (account) {
    // 2回目以降：アカウント選択や許可の画面を省略する
    tokenClient.requestAccessToken({ prompt: "", login_hint: account });
  } else {
    tokenClient.requestAccessToken();
  }
}

// Google のサーバーとやりとりする共通の関数
// async / await は「通信が終わるまで待つ」ための書き方
// body を渡すと「送る」（POST）、渡さなければ「取りに行く」（GET）。method で "DELETE"（消す）も選べる
async function googleRequest(url, body, method) {
  const options = {
    headers: { Authorization: `Bearer ${accessToken}` }, // 通行証を見せる
  };
  if (body) {
    options.method = "POST";
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  if (method) options.method = method;
  const writing = !!body || method === "DELETE";

  const response = await fetch(url, options);
  if (response.status === 401) {
    // 通行証の期限切れ
    clearToken();
    throw new Error("ログインの有効期限が切れました。もう一度「Google でログイン」を押してください。");
  }
  if (response.status === 403 && writing) {
    // 書き込みの許可がない（ログインのときにチェックを外した、など）
    clearToken();
    throw new Error("カレンダーに書き込む許可がありません。「Google でログイン」を押し、予定の作成を許可してください。");
  }
  if (method === "DELETE" && response.status === 410) return null; // もう消えていた
  if (!response.ok) {
    throw new Error(`Google とのやりとりに失敗しました（${response.status}）`);
  }
  if (response.status === 204) return null; // 中身のない返事（消したとき）
  return response.json();
}

function googleGet(url) {
  return googleRequest(url);
}

// カレンダーに予定を作る
// event の例: { summary: "カフェ", start: { dateTime: "2026-11-10T17:00:00", timeZone: "Asia/Tokyo" }, end: {...} }
function createEvent(calendarId, event) {
  const id = encodeURIComponent(calendarId);
  return googleRequest(`https://www.googleapis.com/calendar/v3/calendars/${id}/events`, event);
}

// カレンダーの予定の一部（日時など）を書き換える。changes の例: { start: {...}, end: {...} }
function updateEvent(calendarId, eventId, changes) {
  const cal = encodeURIComponent(calendarId);
  const ev = encodeURIComponent(eventId);
  return googleRequest(`https://www.googleapis.com/calendar/v3/calendars/${cal}/events/${ev}`, changes, "PATCH");
}

// カレンダーの予定を消す（繰り返し予定なら、その日の1回分だけ消える）
function deleteEvent(calendarId, eventId) {
  const cal = encodeURIComponent(calendarId);
  const ev = encodeURIComponent(eventId);
  return googleRequest(`https://www.googleapis.com/calendar/v3/calendars/${cal}/events/${ev}`, null, "DELETE");
}

// 自分のカレンダーの一覧を取る（「個人」「バイト」など）
async function fetchCalendars() {
  const data = await googleGet("https://www.googleapis.com/calendar/v3/users/me/calendarList");
  return data.items || [];
}

// あるカレンダーの、timeMin〜timeMax の予定を取る
// 1回で取りきれないときは、続き（nextPageToken）を取りに行く
async function fetchEvents(calendarId, timeMin, timeMax) {
  const id = encodeURIComponent(calendarId);
  let all = [];
  let pageToken = "";

  do {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: "true",  // 繰り返し予定を1回ずつに分けてもらう
      orderBy: "startTime",
      maxResults: "250",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const data = await googleGet(`https://www.googleapis.com/calendar/v3/calendars/${id}/events?${params}`);
    all = all.concat(data.items || []);
    pageToken = data.nextPageToken; // 続きがなければ undefined になってループが終わる
  } while (pageToken);

  return all;
}
