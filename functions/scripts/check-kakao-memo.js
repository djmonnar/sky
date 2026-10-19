"use strict";

/**
 * 체크리스트 → 카카오톡 「나와의 채팅」 점검 (배포·네트워크 없이 실행)
 *
 *   npm run test:memo
 *
 * Firestore 와 카카오 API 를 메모리 가짜로 바꿔, 연결 링크 → 카카오 로그인 → 토큰 저장 →
 * 시험 메시지, 체크리스트 보내기(200자·토큰 갱신·만료된 곳만 끊기), 연결 끊기를 확인합니다.
 */

const assert = require("node:assert");
const { createKakaoMemo, buildChecklistMemo, checklistRows, MEMO_TEXT_LIMIT } = require("../kakaoMemo");

/* ── 가짜 Firestore ─────────────────────────────────────── */

let db = new Map();
const key = (col, id) => `${col}/${id}`;
function storeDoc(col, id) {
  const k = key(col, id);
  return {
    get: async () => ({ exists: db.has(k), data: () => db.get(k) }),
    set: async (data, options) => {
      const prev = options && options.merge ? db.get(k) || {} : {};
      db.set(k, { ...prev, ...data });
    },
    delete: async () => { db.delete(k); },
  };
}
function storeCol(col) {
  return {
    get: async () => ({
      docs: [...db.entries()]
        .filter(([k]) => k.startsWith(`${col}/`) && k.split("/").length === 2)
        .map(([k, value]) => ({ id: k.split("/")[1], data: () => value })),
    }),
  };
}
const firestoreFn = () => ({
  batch() {
    const ops = [];
    return {
      set: (ref, data, options) => ops.push(() => ref.set(data, options)),
      delete: (ref) => ops.push(() => ref.delete()),
      commit: async () => { for (const op of ops) await op(); },
    };
  },
});
firestoreFn.FieldValue = { serverTimestamp: () => "__ts__" };
const admin = { firestore: firestoreFn };

/* ── 가짜 카카오 ────────────────────────────────────────── */

let calls = [];
let handlers = {};
async function fakeFetch(url, init = {}) {
  const params = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : {};
  const call = { url: String(url), method: init.method || "GET", headers: init.headers || {}, params };
  calls.push(call);
  const path = new URL(url).pathname;
  const handler = handlers[path];
  if (!handler) throw new Error(`처리기 없음: ${path}`);
  const { status = 200, json = {} } = await handler(call);
  return { status, ok: status >= 200 && status < 300, json: async () => json };
}

let clock = 1_800_000_000_000;
let keys = { restApiKey: "REST_KEY", clientSecret: "none" };
let tokenSeq = 0;
const memo = createKakaoMemo({
  admin, storeCol, storeDoc,
  appBaseUrl: "https://sky.example.app",
  redirectUri: "https://fn.example/kakaoMemoAuth",
  getKeys: () => keys,
  fetchImpl: fakeFetch,
  now: () => clock,
  randomToken: () => `invite_token_${String(++tokenSeq).padStart(4, "0")}`,
});

function reset() {
  db = new Map();
  calls = [];
  clock = 1_800_000_000_000;
  keys = { restApiKey: "REST_KEY", clientSecret: "none" };
  handlers = {
    "/oauth/token": ({ params }) => (params.grant_type === "authorization_code"
      ? { json: { access_token: "AT1", refresh_token: "RT1", expires_in: 21599, refresh_token_expires_in: 5183999, scope: "talk_message" } }
      : { json: { access_token: "AT2", expires_in: 21599 } }),
    "/v2/user/me": () => ({ json: { id: 4242, kakao_account: { profile: { nickname: "하늘땅사장" } } } }),
    "/v2/api/talk/memo/default/send": () => ({ json: { result_code: 0 } }),
    "/v1/user/unlink": () => ({ json: { id: 4242 } }),
  };
}

const ADMIN = { uid: "u-admin", name: "김지현", role: "admin" };
const DATE = "2026-10-19"; // 월

async function inviteAndLink(label = "사장님") {
  const { url } = await memo.createInvite({ label, actor: ADMIN });
  const token = new URL(url).searchParams.get("invite");
  await memo.handleAuthRequest({ code: "CODE", state: token });
  return token;
}

const results = [];
async function check(label, fn) {
  reset();
  try {
    await fn();
    results.push(`✅ ${label}`);
  } catch (error) {
    results.push(`❌ ${label}\n   ${error.stack || error.message}`);
    process.exitCode = 1;
  }
}

(async () => {
  /* ── 메시지 글 ── */

  await check("메시지: 짧으면 다 담는다 — 제목·진행률·미완료·특이사항", async () => {
    const rows = [
      { id: "a", section: "open", text: "환기", checked: true },
      { id: "b", section: "open", text: "숯 준비", checked: true },
      { id: "c", section: "close", text: "가스 밸브", checked: true },
      { id: "d", section: "close", text: "쓰레기 배출", checked: false },
    ];
    const text = buildChecklistMemo({ date: DATE, rows, note: "2번 테이블  의자 흔들림" });
    assert.strictEqual(text, [
      "[하늘땅] 10/19(월) 체크리스트",
      "오픈 2/2 ✓ · 마감 1/2",
      "미완료(마감) 쓰레기 배출",
      "특이사항: 2번 테이블 의자 흔들림",
    ].join("\n"));
  });

  await check("메시지: 다 했으면 «모두 끝냈습니다»", async () => {
    const text = buildChecklistMemo({ date: DATE, rows: [{ id: "a", section: "open", text: "환기", checked: true }], note: "" });
    assert.strictEqual(text, "[하늘땅] 10/19(월) 체크리스트\n오픈 1/1 ✓\n모두 끝냈습니다");
  });

  await check("메시지: 길면 200자 안으로 — 제목·진행률은 남기고, 목록은 «외 N개», 특이사항은 «…»", async () => {
    const rows = Array.from({ length: 24 }, (_, i) => ({
      id: `i${i}`, section: i < 12 ? "open" : "close", text: `꽤 긴 이름의 점검 항목 ${i + 1}번`, checked: false,
    }));
    const note = "오늘 단체 손님이 많아 마감이 늦었고 냉장고 2번 문이 잘 안 닫혀서 내일 기사님 부르기로 함. ".repeat(3);
    const text = buildChecklistMemo({ date: DATE, rows, note });
    assert.ok(text.length <= MEMO_TEXT_LIMIT, `${text.length}자`);
    assert.ok(text.startsWith("[하늘땅] 10/19(월) 체크리스트\n오픈 0/12 · 마감 0/12"));
    assert.match(text, /외 \d+개/);
    assert.match(text, /특이사항: .*…$/);
  });

  await check("메시지: 지운 항목은 진행률·미완료에 안 센다", async () => {
    const rows = [
      { id: "a", section: "open", text: "환기", checked: true },
      { id: "x", section: "open", text: "옛 항목", checked: true, removed: true },
    ];
    assert.match(buildChecklistMemo({ date: DATE, rows, note: "" }), /오픈 1\/1/);
  });

  await check("줄 고르기: 화면(src/lib/checklist.ts)과 같은 규칙 — 요일 고정, 지운 항목 남김", async () => {
    const template = { items: [
      { id: "o1", section: "open", text: "환기", days: [] },
      { id: "o2", section: "open", text: "기름 교체", days: [1] },
    ] };
    const day = { checks: { gone: { checked: true, text: "옛 항목", section: "close" } } };
    assert.deepStrictEqual(checklistRows(template, day, DATE).map((r) => [r.id, r.removed]), [["o1", false], ["gone", true]]);
    assert.deepStrictEqual(checklistRows(template, null, "2026-10-20").map((r) => r.id), ["o1", "o2"]);
  });

  /* ── 연결 ── */

  await check("연결 링크: 이름이 있어야 만들고, 24시간짜리 일회용으로 저장", async () => {
    await assert.rejects(memo.createInvite({ label: "  ", actor: ADMIN }), /이름을 적어/);
    const { url, expiresAtMs, label } = await memo.createInvite({ label: " 사장님 ", actor: ADMIN });
    assert.strictEqual(label, "사장님");
    assert.match(url, /^https:\/\/fn\.example\/kakaoMemoAuth\?invite=invite_token_\d{4}$/);
    assert.strictEqual(expiresAtMs, clock + 24 * 60 * 60 * 1000);
    const saved = db.get(`kakaoMemoInvites/${new URL(url).searchParams.get("invite")}`);
    assert.strictEqual(saved.usedAtMs, null);
    assert.strictEqual(saved.createdBy, "김지현");
  });

  await check("연결 링크를 열면 카카오 로그인으로 — 나에게 보내기 권한만 묻는다", async () => {
    const { url } = await memo.createInvite({ label: "사장님", actor: ADMIN });
    const token = new URL(url).searchParams.get("invite");
    const result = await memo.handleAuthRequest({ invite: token });
    assert.strictEqual(result.kind, "redirect");
    const target = new URL(result.url);
    assert.strictEqual(target.origin + target.pathname, "https://kauth.kakao.com/oauth/authorize");
    assert.strictEqual(target.searchParams.get("client_id"), "REST_KEY");
    assert.strictEqual(target.searchParams.get("redirect_uri"), "https://fn.example/kakaoMemoAuth");
    assert.strictEqual(target.searchParams.get("state"), token);
    assert.strictEqual(target.searchParams.get("scope"), "talk_message");
  });

  await check("카카오가 돌려보내면: 토큰은 서버 전용, 화면용 연결 정보, 링크는 사용 처리, 시험 메시지 발송", async () => {
    const token = await inviteAndLink("사장님");
    const tokenCall = calls.find((c) => c.url.endsWith("/oauth/token"));
    assert.deepStrictEqual(tokenCall.params, {
      grant_type: "authorization_code", client_id: "REST_KEY", redirect_uri: "https://fn.example/kakaoMemoAuth", code: "CODE",
    }, "시크릿이 none 이면 보내지 않는다");
    assert.strictEqual(db.get("kakaoMemoTokens/4242").refreshToken, "RT1");
    const link = db.get("kakaoMemoLinks/4242");
    assert.strictEqual(link.label, "사장님");
    assert.strictEqual(link.nickname, "하늘땅사장");
    assert.strictEqual(link.active, true);
    assert.ok(!("accessToken" in link), "화면이 읽는 문서에 토큰이 있으면 안 된다");
    assert.strictEqual(db.get(`kakaoMemoInvites/${token}`).usedBy, "4242");
    const sent = calls.find((c) => c.url.endsWith("/memo/default/send"));
    assert.strictEqual(sent.headers.Authorization, "Bearer AT1");
    assert.match(JSON.parse(sent.params.template_object).text, /나챗방 연결 완료/);
  });

  await check("성공 화면은 이름을 그대로 쓰지 않고 이스케이프한다", async () => {
    const { url } = await memo.createInvite({ label: "<b>사장</b>", actor: ADMIN });
    const result = await memo.handleAuthRequest({ code: "CODE", state: new URL(url).searchParams.get("invite") });
    assert.strictEqual(result.kind, "html");
    assert.match(result.html, /&lt;b&gt;사장&lt;\/b&gt;/);
    assert.ok(!result.html.includes("<b>사장</b>"));
  });

  await check("한 번 쓴 링크·만료된 링크·없는 링크는 막는다", async () => {
    const token = await inviteAndLink();
    assert.match((await memo.handleAuthRequest({ invite: token })).html, /이미 쓴 연결 링크/);
    const { url } = await memo.createInvite({ label: "실장님", actor: ADMIN });
    clock += 24 * 60 * 60 * 1000 + 1;
    assert.match((await memo.handleAuthRequest({ invite: new URL(url).searchParams.get("invite") })).html, /만료/);
    assert.match((await memo.handleAuthRequest({ invite: "nope_nope_nope_nope" })).html, /올바르지 않습니다/);
  });

  await check("카카오 동의를 취소하면 아무것도 저장하지 않고, 같은 링크로 다시 할 수 있다", async () => {
    const { url } = await memo.createInvite({ label: "사장님", actor: ADMIN });
    const token = new URL(url).searchParams.get("invite");
    const result = await memo.handleAuthRequest({ error: "access_denied", state: token });
    assert.match(result.html, /연결을 취소했습니다/);
    assert.strictEqual(db.get(`kakaoMemoInvites/${token}`).usedAtMs, null);
    assert.ok(!db.has("kakaoMemoLinks/4242"));
  });

  await check("「카카오톡 메시지 전송」을 빼고 동의하면 저장하지 않고 다시 동의하라고 한다", async () => {
    handlers["/oauth/token"] = () => ({ json: { access_token: "AT1", refresh_token: "RT1", expires_in: 100, scope: "profile_nickname" } });
    const { url } = await memo.createInvite({ label: "사장님", actor: ADMIN });
    const token = new URL(url).searchParams.get("invite");
    const result = await memo.handleAuthRequest({ code: "CODE", state: token });
    assert.match(result.html, /메시지 동의가 필요합니다/);
    assert.ok(!db.has("kakaoMemoTokens/4242"));
    assert.strictEqual(db.get(`kakaoMemoInvites/${token}`).usedAtMs, null);
  });

  await check("클라이언트 시크릿을 쓰는 앱이면 토큰 요청에 싣는다", async () => {
    keys = { restApiKey: "REST_KEY", clientSecret: "SECRET_X" };
    await inviteAndLink();
    assert.strictEqual(calls.find((c) => c.url.endsWith("/oauth/token")).params.client_secret, "SECRET_X");
  });

  await check("REST API 키가 없으면 링크를 만들기 전에 알린다", async () => {
    keys = { restApiKey: "", clientSecret: "none" };
    await assert.rejects(memo.createInvite({ label: "사장님", actor: ADMIN }), /KAKAO_REST_API_KEY/);
  });

  /* ── 보내기 ── */

  const seedChecklist = () => {
    db.set("meta/checklistTemplate", { items: [
      { id: "o1", section: "open", text: "환기", days: [] },
      { id: "c1", section: "close", text: "가스 밸브", days: [] },
    ] });
    db.set(`checklistDays/${DATE}`, { date: DATE, note: "의자 흔들림", checks: { o1: { checked: true, text: "환기", section: "open" } } });
  };

  await check("보내기: 연결된 곳이 없으면 먼저 연결하라고 한다", async () => {
    seedChecklist();
    await assert.rejects(memo.sendChecklist({ date: DATE, actor: ADMIN }), /연결된 나챗방이 없습니다/);
  });

  await check("보내기: 요약 글 + 체크리스트 링크, 보낸 기록을 남긴다", async () => {
    seedChecklist();
    await inviteAndLink();
    calls = [];
    const result = await memo.sendChecklist({ date: DATE, actor: { name: "이바다" } });
    assert.deepStrictEqual(result.delivered, ["사장님"]);
    assert.deepStrictEqual(result.failed, []);
    const template = JSON.parse(calls.find((c) => c.url.endsWith("/memo/default/send")).params.template_object);
    assert.strictEqual(template.object_type, "text");
    assert.strictEqual(template.text, "[하늘땅] 10/19(월) 체크리스트\n오픈 1/1 ✓ · 마감 0/1\n미완료(마감) 가스 밸브\n특이사항: 의자 흔들림");
    assert.strictEqual(template.link.web_url, "https://sky.example.app/checklist?date=2026-10-19");
    assert.strictEqual(template.button_title, "체크리스트 열기");
    const day = db.get(`checklistDays/${DATE}`);
    assert.deepStrictEqual({ ...day.sent, at: undefined }, { at: undefined, by: "이바다", delivered: 1, failed: 0 });
    assert.strictEqual(day.note, "의자 흔들림", "보낸 기록을 쓰면서 다른 칸을 지우면 안 된다");
  });

  await check("보내기: 액세스 토큰이 만료됐으면 갱신해서 보내고, 새 리프레시 토큰이 오면 바꿔 둔다", async () => {
    seedChecklist();
    await inviteAndLink();
    clock += 7 * 60 * 60 * 1000; // 6시간짜리 액세스 토큰 만료
    handlers["/oauth/token"] = ({ params }) => {
      assert.strictEqual(params.grant_type, "refresh_token");
      assert.strictEqual(params.refresh_token, "RT1");
      return { json: { access_token: "AT2", expires_in: 21599, refresh_token: "RT2", refresh_token_expires_in: 5183999 } };
    };
    calls = [];
    await memo.sendChecklist({ date: DATE, actor: ADMIN });
    assert.strictEqual(calls.find((c) => c.url.endsWith("/memo/default/send")).headers.Authorization, "Bearer AT2");
    assert.strictEqual(db.get("kakaoMemoTokens/4242").refreshToken, "RT2");
  });

  await check("보내기: 카카오가 401 이면 한 번 갱신해서 다시 보낸다", async () => {
    seedChecklist();
    await inviteAndLink();
    let first = true;
    handlers["/v2/api/talk/memo/default/send"] = ({ headers }) => {
      if (first) { first = false; return { status: 401, json: { code: -401, msg: "this access token does not exist" } }; }
      assert.strictEqual(headers.Authorization, "Bearer AT2");
      return { json: { result_code: 0 } };
    };
    const result = await memo.sendChecklist({ date: DATE, actor: ADMIN });
    assert.deepStrictEqual(result.delivered, ["사장님"]);
  });

  await check("보내기: 연결이 만료된 곳만 실패·끊김 표시, 다른 곳은 그대로 받는다", async () => {
    seedChecklist();
    await inviteAndLink("사장님");
    handlers["/v2/user/me"] = () => ({ json: { id: 5151 } });
    await inviteAndLink("실장님");
    db.set("kakaoMemoTokens/4242", { ...db.get("kakaoMemoTokens/4242"), accessTokenExpiresAtMs: 0, refreshToken: "DEAD" });
    handlers["/oauth/token"] = ({ params }) => (params.refresh_token === "DEAD"
      ? { status: 400, json: { error: "invalid_grant", error_code: "KOE322" } }
      : { json: { access_token: "AT9", expires_in: 21599 } });
    const result = await memo.sendChecklist({ date: DATE, actor: ADMIN });
    assert.deepStrictEqual(result.delivered, ["실장님"]);
    assert.strictEqual(result.failed.length, 1);
    assert.strictEqual(result.failed[0].label, "사장님");
    assert.match(result.failed[0].message, /만료/);
    assert.strictEqual(db.get("kakaoMemoLinks/4242").active, false);
    assert.match(db.get("kakaoMemoLinks/4242").lastError, /다시 연결/);
    assert.strictEqual(db.get("kakaoMemoLinks/5151").active, true);
    assert.strictEqual(db.get("kakaoMemoLinks/5151").nickname, null, "닉네임 동의가 없으면 null");
  });

  await check("보내기: 날짜가 이상하면 막는다", async () => {
    await assert.rejects(memo.sendChecklist({ date: "10/19", actor: ADMIN }), /날짜가 올바르지 않습니다/);
  });

  /* ── 끊기 ── */

  await check("끊기: 카카오 쪽 권한도 회수하고 토큰·연결을 지운다", async () => {
    await inviteAndLink();
    calls = [];
    await memo.unlink({ linkId: "4242" });
    assert.ok(calls.some((c) => c.url.endsWith("/v1/user/unlink")));
    assert.ok(!db.has("kakaoMemoTokens/4242"));
    assert.ok(!db.has("kakaoMemoLinks/4242"));
  });

  await check("끊기: 이미 만료돼 카카오 회수가 안 돼도 우리 쪽은 지운다", async () => {
    await inviteAndLink();
    db.set("kakaoMemoTokens/4242", { ...db.get("kakaoMemoTokens/4242"), accessTokenExpiresAtMs: 0 });
    handlers["/oauth/token"] = () => ({ status: 400, json: { error: "invalid_grant" } });
    await memo.unlink({ linkId: "4242" });
    assert.ok(!db.has("kakaoMemoLinks/4242"));
  });

  console.log(results.join("\n"));
  console.log(process.exitCode ? "\n실패한 검사가 있습니다." : "\n모든 검사를 통과했습니다.");
})();
