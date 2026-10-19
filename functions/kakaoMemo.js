"use strict";

/**
 * 체크리스트를 카카오톡 「나와의 채팅」(나챗방)으로 보낸다.
 *
 * **왜 나와의 채팅인가.** 사장님 카톡 「나와의 채팅」은 사장님만 보는 방이라 비즈 채널·
 * 친구 동의 없이 받을 수 있다(카카오 「나에게 보내기」 API). 대신 받는 사람이 **자기 카카오로
 * 한 번 로그인해서 이 앱에 「카카오톡 메시지 전송」을 허락**해야 한다 — 그게 «연결»이다.
 *
 * **연결은 링크로 한다.** 사장님이 대시보드에서 「연결 링크」를 만든다. 그 링크를 본인이
 * 누르든, 실장님께 보내 누르게 하든, 누른 사람의 카카오가 받는 곳으로 등록된다. 링크는
 * 한 번만 쓰이고 24시간 뒤 사라진다.
 *
 *   링크(kakaoMemoAuth?invite=…) → 카카오 로그인·동의 → kakaoMemoAuth?code=…&state=…
 *   → 토큰을 받아 서버 전용 컬렉션에 두고 → 시험 메시지를 바로 보낸다(그 방에서 확인)
 *
 * **토큰은 화면이 못 읽는다.** 화면은 kakaoMemoLinks(이름·연결 시각)만 읽고, 토큰은
 * kakaoMemoTokens 에 있다 — Firestore 규칙이 둘 다 화면 쓰기를 막고, 토큰은 읽기도 막는다.
 *
 * **메시지는 200자.** 카카오 텍스트 템플릿 한도다. 그래서 진행률·미완료·특이사항만 줄여
 * 담고, 전체는 「체크리스트 열기」 링크로 본다.
 */

const KAUTH = "https://kauth.kakao.com";
const KAPI = "https://kapi.kakao.com";
/** 카카오 텍스트 템플릿 text 최대 길이 */
const MEMO_TEXT_LIMIT = 200;
/** 연결 링크 수명 */
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
/** 액세스 토큰은 만료 5분 전이면 미리 갈아 둔다 */
const ACCESS_TOKEN_SKEW_MS = 5 * 60 * 1000;

const SECTIONS = ["open", "close"];
const SECTION_LABEL = { open: "오픈", close: "마감" };
const DOW = ["월", "화", "수", "목", "금", "토", "일"];

/**
 * checklistApi 의 할 일별로 누가 할 수 있나. **보내기도 사장님(관리자)만** — 사장님 카톡으로 가는
 * 것이라 사장님이 확인하고 보낸다(2026-10-19 사장님 결정). 매니저·직원은 체크·특이사항까지.
 */
const ACTION_ROLES = {
  send: ["admin"],
  invite: ["admin"],
  unlink: ["admin"],
  // 매일 자동으로 가는 것(오늘 예약 11시, 일일 정산 22시 30분)을 «시험으로 보내기»
  sendReservations: ["admin"],
  sendSettlement: ["admin"],
};

function canRun(action, role) {
  return Boolean(ACTION_ROLES[action] && ACTION_ROLES[action].includes(role));
}

class MemoError extends Error {
  /** @param {"config"|"expired"|"scope"|"no_token"|"kakao"|"bad_request"} code */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/* ── 체크리스트 줄 — 화면의 src/lib/checklist.ts dayRows 와 같은 규칙이어야 한다 ── */

/** "YYYY-MM-DD" → 월=0 … 일=6 */
function weekdayOf(date) {
  const [y, m, d] = String(date).split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** 그날 보여 줄 줄: 템플릿 중 그 요일 것 + 템플릿에서 빠졌지만 그날 체크해 둔 것 */
function checklistRows(template, day, date) {
  const checks = (day && day.checks) || {};
  const rows = [];
  const shown = new Set();
  const dow = weekdayOf(date);
  for (const item of (template && Array.isArray(template.items) ? template.items : [])) {
    const days = Array.isArray(item.days) ? item.days : [];
    if (days.length > 0 && !days.includes(dow)) continue;
    shown.add(item.id);
    rows.push({
      id: item.id,
      section: item.section === "close" ? "close" : "open",
      text: String(item.text || ""),
      checked: Boolean(checks[item.id] && checks[item.id].checked),
      removed: false,
    });
  }
  Object.entries(checks).forEach(([id, check]) => {
    if (shown.has(id) || !check || !check.checked) return;
    rows.push({ id, section: check.section === "close" ? "close" : "open", text: String(check.text || ""), checked: true, removed: true });
  });
  return SECTIONS.flatMap((section) => rows.filter((row) => row.section === section));
}

/* ── 메시지 ─────────────────────────────────────────────── */

function clip(text, budget) {
  if (budget <= 0) return "";
  return text.length <= budget ? text : `${text.slice(0, Math.max(0, budget - 1))}…`;
}

/** 이름들을 budget 안에 «A, B 외 N개»로 */
function fitNames(prefix, names, budget) {
  for (let shownCount = names.length; shownCount >= 0; shownCount -= 1) {
    const rest = names.length - shownCount;
    const body = names.slice(0, shownCount).join(", ");
    const tail = rest > 0 ? `${shownCount > 0 ? " " : ""}외 ${rest}개` : "";
    const line = `${prefix}${body}${tail}`;
    if (line.length <= budget) return line;
  }
  return "";
}

/**
 * 나챗방에 보낼 글. **항상 200자 안.** 제목과 진행률은 꼭 남기고, 넘치면 미완료 목록을
 * «외 N개»로, 특이사항을 «…»로 줄인다. 전체는 링크로 본다.
 */
function buildChecklistMemo({ date, rows, note }) {
  const md = `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}(${DOW[weekdayOf(date)]})`;
  const title = `[하늘땅] ${md} 체크리스트`;
  const live = rows.filter((row) => !row.removed);
  const parts = SECTIONS
    .map((section) => {
      const inSection = live.filter((row) => row.section === section);
      if (inSection.length === 0) return null;
      const done = inSection.filter((row) => row.checked).length;
      return `${SECTION_LABEL[section]} ${done}/${inSection.length}${done === inSection.length ? " ✓" : ""}`;
    })
    .filter(Boolean);
  const progress = parts.length > 0 ? parts.join(" · ") : "항목 없음";
  const pending = SECTIONS
    .map((section) => ({
      prefix: `미완료(${SECTION_LABEL[section]}) `,
      names: live.filter((row) => row.section === section && !row.checked).map((row) => row.text),
    }))
    .filter((group) => group.names.length > 0);
  const noteText = String(note || "").replace(/\s+/g, " ").trim();
  const noteLine = noteText ? `특이사항: ${noteText}` : "";
  const allDone = live.length > 0 && pending.length === 0;

  const head = [title, progress, ...(allDone ? ["모두 끝냈습니다"] : [])].join("\n");
  const full = [head, ...pending.map((g) => `${g.prefix}${g.names.join(", ")}`), ...(noteLine ? [noteLine] : [])].join("\n");
  if (full.length <= MEMO_TEXT_LIMIT) return full;

  // 넘친다 — 특이사항에 먼저 일부(최대 60자)를 떼어 두고 미완료를 맞춘 뒤, 남는 자리를 특이사항에 돌려준다
  const lines = [head];
  let left = MEMO_TEXT_LIMIT - head.length;
  const noteReserve = noteLine ? Math.min(noteLine.length, 60) + 1 : 0;
  let pendingBudget = left - noteReserve;
  const pendingLines = [];
  for (const group of pending) {
    const line = fitNames(group.prefix, group.names, pendingBudget - 1);
    if (!line) break;
    pendingLines.push(line);
    pendingBudget -= line.length + 1;
  }
  lines.push(...pendingLines);
  left = MEMO_TEXT_LIMIT - lines.join("\n").length;
  if (noteLine && left > 8) lines.push(clip(noteLine, left - 1));
  return lines.join("\n").slice(0, MEMO_TEXT_LIMIT);
}

/* ── HTML (연결 결과 화면) ─────────────────────────────── */

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function resultPage({ ok, title, body, appUrl }) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;background:#f5f5f5;color:#111;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}
main{background:#fff;border:1px solid #e5e5e5;border-radius:16px;padding:28px 24px;max-width:420px;width:100%;box-sizing:border-box}
h1{font-size:20px;margin:0 0 10px}p{margin:0 0 14px;line-height:1.6;color:#444;word-break:keep-all}
.mark{font-size:34px;margin-bottom:8px}a{display:inline-block;margin-top:6px;padding:11px 16px;border-radius:10px;background:#111;color:#fff;text-decoration:none;font-weight:700}</style>
</head><body><main><div class="mark">${ok ? "✅" : "⚠️"}</div><h1>${escapeHtml(title)}</h1>${body.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
<a href="${escapeHtml(appUrl)}">하늘땅 체크리스트 열기</a></main></body></html>`;
}

/* ── 카카오 ─────────────────────────────────────────────── */

function createKakaoMemo(deps) {
  const {
    admin, storeCol, storeDoc,
    appBaseUrl, redirectUri,
    /** () => ({ restApiKey, clientSecret }) — 호출할 때 읽는다(시크릿) */
    getKeys,
    fetchImpl = (...args) => fetch(...args),
    now = () => Date.now(),
    randomToken,
  } = deps;

  const serverTime = () => admin.firestore.FieldValue.serverTimestamp();
  const checklistUrl = (date) => new URL(`/checklist${date ? `?date=${encodeURIComponent(date)}` : ""}`, appBaseUrl).toString();

  function keys() {
    const { restApiKey, clientSecret } = getKeys();
    if (!restApiKey) throw new MemoError("config", "카카오 REST API 키가 설정되지 않았습니다. KAKAO_REST_API_KEY 시크릿을 등록해 주세요.");
    const secret = clientSecret && !/^(none|-|off)$/i.test(clientSecret.trim()) ? clientSecret.trim() : "";
    return { restApiKey: restApiKey.trim(), clientSecret: secret };
  }

  async function postForm(url, params, token) {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: new URLSearchParams(params).toString(),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, json };
  }

  /* 연결 링크 */

  async function createInvite({ label, actor }) {
    const cleanLabel = String(label || "").replace(/\s+/g, " ").trim().slice(0, 20);
    if (!cleanLabel) throw new MemoError("bad_request", "누구의 나챗방인지 이름을 적어 주세요. (예: 사장님)");
    keys(); // 키가 없으면 링크를 만들기 전에 알린다
    const token = randomToken();
    const expiresAtMs = now() + INVITE_TTL_MS;
    await storeDoc("kakaoMemoInvites", token).set({
      label: cleanLabel,
      createdBy: actor.name || "",
      createdByUid: actor.uid || "",
      createdAt: serverTime(),
      expiresAtMs,
      usedAtMs: null,
    });
    return { url: `${redirectUri}?invite=${encodeURIComponent(token)}`, expiresAtMs, label: cleanLabel };
  }

  async function loadInvite(token) {
    if (!token || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null;
    const snap = await storeDoc("kakaoMemoInvites", token).get();
    return snap.exists ? snap.data() : null;
  }

  function inviteProblem(invite) {
    if (!invite) return "연결 링크가 올바르지 않습니다. 대시보드에서 새 링크를 만들어 주세요.";
    if (invite.usedAtMs) return "이미 쓴 연결 링크입니다. 다시 연결하려면 대시보드에서 새 링크를 만들어 주세요.";
    if (Number(invite.expiresAtMs) < now()) return "연결 링크가 만료됐습니다(24시간). 대시보드에서 새 링크를 만들어 주세요.";
    return null;
  }

  /**
   * kakaoMemoAuth 한 곳이 두 가지를 한다.
   *  - ?invite=…      → 카카오 로그인으로 보낸다 (state = 초대 토큰)
   *  - ?code=&state=  → 카카오가 돌려보낸 자리. 토큰을 받아 저장하고 시험 메시지를 보낸다
   * @returns {{ kind: "redirect", url: string } | { kind: "html", status: number, html: string }}
   */
  async function handleAuthRequest(query) {
    const page = (status, ok, title, body) => ({
      kind: "html", status, html: resultPage({ ok, title, body, appUrl: checklistUrl() }),
    });

    if (query.invite) {
      const invite = await loadInvite(String(query.invite));
      const problem = inviteProblem(invite);
      if (problem) return page(400, false, "연결할 수 없습니다", [problem]);
      const { restApiKey } = keys();
      const url = new URL(`${KAUTH}/oauth/authorize`);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", restApiKey);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("state", String(query.invite));
      // 나에게 보내기 권한만 묻는다 — 설정 안 한 동의항목을 물으면 카카오가 KOE205 로 막는다
      url.searchParams.set("scope", "talk_message");
      return { kind: "redirect", url: url.toString() };
    }

    const state = String(query.state || "");
    const invite = await loadInvite(state);
    const problem = inviteProblem(invite);
    if (problem) return page(400, false, "연결할 수 없습니다", [problem]);

    if (query.error) {
      return page(200, false, "연결을 취소했습니다", [
        "카카오 동의를 마치지 않아 연결하지 않았습니다.",
        "같은 링크를 다시 누르면 처음부터 할 수 있습니다(24시간 안).",
      ]);
    }
    if (!query.code) return page(400, false, "연결할 수 없습니다", ["카카오가 돌려준 값이 없습니다. 링크를 다시 눌러 주세요."]);

    const { restApiKey, clientSecret } = keys();
    const tokenRes = await postForm(`${KAUTH}/oauth/token`, {
      grant_type: "authorization_code",
      client_id: restApiKey,
      redirect_uri: redirectUri,
      code: String(query.code),
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    });
    if (!tokenRes.ok || !tokenRes.json.access_token) {
      console.error("KAKAO_TOKEN_FAILED", tokenRes.status, tokenRes.json);
      const hint = tokenRes.json.error_code === "KOE010"
        ? "클라이언트 시크릿이 맞지 않습니다 — KAKAO_CLIENT_SECRET 을 확인해 주세요."
        : `카카오 응답: ${tokenRes.json.error_description || tokenRes.json.error || tokenRes.status}`;
      return page(502, false, "카카오 연결에 실패했습니다", ["토큰을 받지 못했습니다.", hint]);
    }
    const tokens = tokenRes.json;
    const scopes = String(tokens.scope || "").split(/[\s,]+/);
    if (tokens.scope && !scopes.includes("talk_message")) {
      // 링크는 그대로 둔다 — 다시 눌러 동의하면 된다
      return page(200, false, "메시지 동의가 필요합니다", [
        "「카카오톡 메시지 전송」에 동의해야 나와의 채팅으로 받을 수 있습니다.",
        "같은 링크를 다시 눌러 그 항목에 동의해 주세요.",
      ]);
    }

    const meRes = await fetchImpl(`${KAPI}/v2/user/me`, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const me = await meRes.json().catch(() => ({}));
    if (!meRes.ok || !me.id) {
      console.error("KAKAO_ME_FAILED", meRes.status, me);
      return page(502, false, "카카오 연결에 실패했습니다", ["카카오 계정 정보를 읽지 못했습니다. 링크를 다시 눌러 주세요."]);
    }
    const linkId = String(me.id);
    const nickname = me.kakao_account && me.kakao_account.profile && me.kakao_account.profile.nickname
      ? String(me.kakao_account.profile.nickname)
      : null;

    const batch = admin.firestore().batch();
    batch.set(storeDoc("kakaoMemoTokens", linkId), {
      accessToken: tokens.access_token,
      accessTokenExpiresAtMs: now() + Number(tokens.expires_in || 0) * 1000,
      refreshToken: tokens.refresh_token,
      refreshTokenExpiresAtMs: now() + Number(tokens.refresh_token_expires_in || 0) * 1000,
      scope: tokens.scope || "",
      updatedAt: serverTime(),
    });
    batch.set(storeDoc("kakaoMemoLinks", linkId), {
      id: linkId,
      label: invite.label,
      nickname,
      linkedAt: serverTime(),
      linkedBy: invite.createdBy || "",
      active: true,
      lastError: null,
    }, { merge: true });
    batch.set(storeDoc("kakaoMemoInvites", state), { usedAtMs: now(), usedBy: linkId }, { merge: true });
    await batch.commit();

    // 시험 메시지 — 그 방에서 바로 확인한다
    try {
      await sendMemo(linkId, {
        text: `[하늘땅] 나챗방 연결 완료\n이제 체크리스트를 보내면 이 방(${invite.label})으로 옵니다.`,
        link: checklistUrl(),
      });
      return page(200, true, "연결됐습니다", [
        `「${invite.label}」 나챗방으로 등록했습니다${nickname ? ` (카카오 ${nickname})` : ""}.`,
        "카카오톡 「나와의 채팅」에 시험 메시지를 보냈습니다. 이 창은 닫아도 됩니다.",
      ]);
    } catch (error) {
      return page(200, false, "연결은 됐습니다 — 시험 메시지는 실패", [
        `「${invite.label}」 나챗방으로 등록했지만 시험 메시지를 보내지 못했습니다.`,
        error.message || "카카오 응답을 확인해 주세요.",
      ]);
    }
  }

  /* 토큰 */

  async function accessTokenFor(linkId, { forceRefresh = false } = {}) {
    const ref = storeDoc("kakaoMemoTokens", linkId);
    const snap = await ref.get();
    if (!snap.exists) throw new MemoError("no_token", "연결 정보가 없습니다 — 다시 연결해 주세요.");
    const saved = snap.data();
    if (!forceRefresh && saved.accessToken && Number(saved.accessTokenExpiresAtMs) - ACCESS_TOKEN_SKEW_MS > now()) {
      return saved.accessToken;
    }
    const { restApiKey, clientSecret } = keys();
    const res = await postForm(`${KAUTH}/oauth/token`, {
      grant_type: "refresh_token",
      client_id: restApiKey,
      refresh_token: saved.refreshToken,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    });
    if (!res.ok || !res.json.access_token) {
      console.error("KAKAO_REFRESH_FAILED", linkId, res.status, res.json);
      if (res.json.error === "invalid_grant" || res.status === 400 || res.status === 401) {
        throw new MemoError("expired", "카카오 연결이 만료됐습니다 — 다시 연결해 주세요.");
      }
      throw new MemoError("kakao", `카카오 토큰을 갱신하지 못했습니다 (${res.status}).`);
    }
    // 리프레시 토큰은 만료 한 달 전부터만 새로 온다 — 왔을 때만 바꾼다
    await ref.set({
      accessToken: res.json.access_token,
      accessTokenExpiresAtMs: now() + Number(res.json.expires_in || 0) * 1000,
      ...(res.json.refresh_token ? {
        refreshToken: res.json.refresh_token,
        refreshTokenExpiresAtMs: now() + Number(res.json.refresh_token_expires_in || 0) * 1000,
      } : {}),
      updatedAt: serverTime(),
    }, { merge: true });
    return res.json.access_token;
  }

  async function sendMemo(linkId, { text, link, buttonTitle = "체크리스트 열기" }) {
    const templateObject = JSON.stringify({
      object_type: "text",
      text: text.slice(0, MEMO_TEXT_LIMIT),
      link: { web_url: link, mobile_web_url: link },
      button_title: buttonTitle,
    });
    const attempt = async (token) => postForm(`${KAPI}/v2/api/talk/memo/default/send`, { template_object: templateObject }, token);
    let res = await attempt(await accessTokenFor(linkId));
    if (res.status === 401) res = await attempt(await accessTokenFor(linkId, { forceRefresh: true }));
    if (res.ok && Number(res.json.result_code) === 0) return;
    console.error("KAKAO_MEMO_FAILED", linkId, res.status, res.json);
    if (res.json.code === -402 || res.status === 403) {
      throw new MemoError("scope", "카카오톡 메시지 전송 동의가 없습니다 — 다시 연결해 주세요.");
    }
    if (res.status === 401) throw new MemoError("expired", "카카오 연결이 만료됐습니다 — 다시 연결해 주세요.");
    throw new MemoError("kakao", `카카오가 메시지를 받지 않았습니다 (${res.json.msg || res.status}).`);
  }

  /* 등록된 나챗방 모두에 — 체크리스트·오늘 예약·일일 정산이 같이 쓴다 */

  async function activeLinks() {
    const snap = await storeCol("kakaoMemoLinks").get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((link) => link.active !== false);
  }

  /**
   * 한 곳이 실패해도 나머지는 받는다. 연결이 만료됐거나 동의가 빠진 곳은 «끊김»으로 표시해
   * 화면이 다시 연결하라고 말하게 한다. 받는 곳이 없으면 아무것도 안 하고 빈 결과를 돌려준다.
   */
  async function broadcast({ text, link, buttonTitle }) {
    const links = await activeLinks();
    const delivered = [];
    const failed = [];
    for (const target of links) {
      try {
        await sendMemo(target.id, { text, link, buttonTitle });
        delivered.push(target.label);
        await storeDoc("kakaoMemoLinks", target.id).set({ lastSentAt: serverTime(), lastError: null }, { merge: true });
      } catch (error) {
        failed.push({ label: target.label, message: error.message });
        await storeDoc("kakaoMemoLinks", target.id).set({
          lastError: error.message,
          ...(error.code === "expired" || error.code === "scope" || error.code === "no_token" ? { active: false } : {}),
        }, { merge: true });
      }
    }
    return { linkCount: links.length, delivered, failed };
  }

  /* 체크리스트 보내기 */

  async function sendChecklist({ date, actor }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw new MemoError("bad_request", "날짜가 올바르지 않습니다.");
    keys();
    const [templateSnap, daySnap, links] = await Promise.all([
      storeDoc("meta", "checklistTemplate").get(),
      storeDoc("checklistDays", date).get(),
      activeLinks(),
    ]);
    if (links.length === 0) {
      throw new MemoError("bad_request", "연결된 나챗방이 없습니다. 관리자가 체크리스트 화면에서 먼저 연결해 주세요.");
    }
    const day = daySnap.exists ? daySnap.data() : null;
    const rows = checklistRows(templateSnap.exists ? templateSnap.data() : null, day, date);
    const text = buildChecklistMemo({ date, rows, note: day ? day.note : "" });
    const { delivered, failed } = await broadcast({ text, link: checklistUrl(date), buttonTitle: "체크리스트 열기" });
    await storeDoc("checklistDays", date).set({
      date,
      sent: { at: serverTime(), by: actor.name || "", delivered: delivered.length, failed: failed.length },
    }, { merge: true });
    return { text, delivered, failed };
  }

  /* 연결 끊기 */

  async function unlink({ linkId }) {
    const id = String(linkId || "");
    if (!/^\d{1,30}$/.test(id)) throw new MemoError("bad_request", "연결 id 가 올바르지 않습니다.");
    // 카카오 쪽 연결도 끊는다(이 앱 권한 회수). 이미 만료됐으면 그냥 지운다.
    try {
      const token = await accessTokenFor(id);
      await postForm(`${KAPI}/v1/user/unlink`, {}, token);
    } catch (error) {
      console.warn("KAKAO_UNLINK_SKIPPED", id, error.message);
    }
    const batch = admin.firestore().batch();
    batch.delete(storeDoc("kakaoMemoTokens", id));
    batch.delete(storeDoc("kakaoMemoLinks", id));
    await batch.commit();
    return { ok: true };
  }

  return { createInvite, handleAuthRequest, sendChecklist, unlink, sendMemo, broadcast, activeLinks, keys };
}

module.exports = {
  createKakaoMemo,
  canRun,
  ACTION_ROLES,
  buildChecklistMemo,
  checklistRows,
  weekdayOf,
  MemoError,
  MEMO_TEXT_LIMIT,
};
