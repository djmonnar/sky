/**
 * 그랜터가 받아온 계좌 거래에 어느 은행이 들어 있는지 본다 (읽기 전용).
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=<서비스계정.json> node scripts/check-granter-banks.mjs
 *   ... node scripts/check-granter-banks.mjs --찾기 기업        # 특정 낱말만 훑기
 *   ... node scripts/check-granter-banks.mjs --샘플             # 원본 한 건을 통째로 보기
 *
 * **아무것도 쓰지 않는다.** 읽기만 한다.
 *
 * 왜 이런 모양인가: 우리 코드는 은행을 구분하지 않는다. 그랜터에 «계좌 거래를 달라» 고
 * 하고 주는 대로 저장할 뿐이라, 은행 이름이 어느 필드에 실려 오는지 코드만 봐서는 모른다
 * (그랜터 원본이 `detail` 에 통째로 들어간다). 그래서 이 스크립트는 먼저 필드를 훑어
 * «은행처럼 보이는 값» 을 찾아내고, 그 다음 세어 준다.
 */
import { createRequire } from "node:module";

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = require("firebase-admin");

const STORE_ID = process.env.STORE_ID || "haneulttang";
const args = process.argv.slice(2);
const showSample = args.includes("--샘플") || args.includes("--sample");
const findIndex = args.findIndex((a) => a === "--찾기" || a === "--find");
const findWord = findIndex >= 0 ? args[findIndex + 1] : null;

/** 기업은행이 실려 올 수 있는 표기들. 어느 쪽으로 와도 잡으려고 넓게 둔다. */
const IBK_WORDS = ["기업은행", "기업", "IBK", "ibk", "중소기업은행"];

admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();
const store = db.collection("stores").doc(STORE_ID);

/** 중첩 객체를 "a.b.c" → 값 으로 평평하게 편다. 은행 이름이 어디 숨었는지 모르니까. */
function flatten(value, prefix = "", out = {}) {
  if (value === null || value === undefined) return out;
  if (typeof value !== "object") {
    out[prefix] = value;
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => flatten(item, `${prefix}[${i}]`, out));
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    flatten(child, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

function hasWord(text, words) {
  const haystack = String(text).toLowerCase();
  return words.some((w) => haystack.includes(w.toLowerCase()));
}

console.log(`매장: ${STORE_ID}\n`);

/* ── 1. 동기화 이력 ───────────────────────────────────────────────────── */
const runs = (await store.collection("granterSyncRuns").get()).docs
  .map((d) => d.data())
  .sort((a, b) => String(b.id ?? "").localeCompare(String(a.id ?? "")))
  .slice(0, 10);

console.log("── 최근 동기화 ──");
if (runs.length === 0) {
  console.log("  기록이 없습니다. 한 번도 안 돌았거나 기록이 지워졌습니다.\n");
} else {
  for (const run of runs) {
    const when = run.finishedAt?.toDate?.()?.toISOString?.().slice(0, 16).replace("T", " ")
      ?? run.startedAt?.toDate?.()?.toISOString?.().slice(0, 16).replace("T", " ")
      ?? "?";
    console.log(
      `  ${when}  ${run.status ?? "?"}`
      + `  계좌 받음 ${(run.accountImportedCount ?? 0) + (run.accountUpdatedCount ?? 0)}건`
      + `  카드 ${(run.cardImportedCount ?? 0) + (run.cardUpdatedCount ?? 0)}건`
      + (run.message ? `\n      ${run.message}` : "")
    );
  }
  console.log("");
}

/* ── 2. 저장된 계좌 거래 ──────────────────────────────────────────────── */
const rows = (await store.collection("granterAccountTransactions").get()).docs.map((d) => d.data());

console.log("── 저장된 계좌 거래 ──");
if (rows.length === 0) {
  console.log("  0건. 계좌 거래를 한 건도 못 받아왔습니다.");
  console.log("  → 은행 문제가 아니라 계좌 연동 자체가 안 된 것입니다.\n");
  process.exit(0);
}

const dates = rows.map((r) => String(r.businessDate ?? "")).filter(Boolean).sort();
console.log(`  ${rows.length}건 · ${dates[0] ?? "?"} ~ ${dates[dates.length - 1] ?? "?"}\n`);

/* ── 3. 은행 이름이 어느 필드에 있나 ──────────────────────────────────── */
// 필드 이름에 bank/account/은행 이 들어간 것을 후보로 본다.
const fieldValues = new Map(); // 필드경로 → Map(값 → 건수)
for (const row of rows) {
  for (const [path, value] of Object.entries(flatten(row))) {
    if (typeof value !== "string" || !value.trim()) continue;
    if (!/bank|account|은행|계좌|inst|org/i.test(path)) continue;
    if (!fieldValues.has(path)) fieldValues.set(path, new Map());
    const counts = fieldValues.get(path);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
}

console.log("── 은행·계좌로 보이는 필드 ──");
if (fieldValues.size === 0) {
  console.log("  없습니다. 저장된 거래에 은행을 가리키는 글자가 아예 없습니다.");
  console.log("  → 그랜터가 은행 이름을 안 실어 줬거나, 다른 이름의 필드에 있습니다.");
  console.log("  → `--샘플` 로 원본 한 건을 통째로 보세요.\n");
} else {
  for (const [path, counts] of fieldValues) {
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    console.log(`  ${path}`);
    for (const [value, count] of top) {
      const mark = hasWord(value, IBK_WORDS) ? "  ← 기업은행?" : "";
      console.log(`      ${String(count).padStart(5)}건  ${value}${mark}`);
    }
    if (counts.size > 12) console.log(`      ... 그 밖에 ${counts.size - 12}가지`);
  }
  console.log("");
}

/* ── 4. 기업은행 정면 검색 ────────────────────────────────────────────── */
const words = findWord ? [findWord] : IBK_WORDS;
console.log(`── "${words.join(" / ")}" 가 들어간 거래 ──`);

const hits = [];
for (const row of rows) {
  const flat = flatten(row);
  const matched = Object.entries(flat).filter(
    ([, value]) => typeof value === "string" && hasWord(value, words)
  );
  if (matched.length > 0) hits.push({ row, matched });
}

if (hits.length === 0) {
  console.log(`  0건. 저장된 ${rows.length}건 어디에도 없습니다.`);
  console.log("  → 그랜터가 그 은행 거래를 안 보내 줬다는 뜻입니다.");
  console.log("     (우리 코드는 은행을 안 가립니다 — 받은 건 다 저장합니다.)");
} else {
  console.log(`  ${hits.length}건 찾았습니다.\n`);
  for (const { row, matched } of hits.slice(0, 10)) {
    const amount = Number(row.amount ?? 0).toLocaleString("ko-KR");
    console.log(`  ${row.businessDate ?? "?"}  ${row.direction === "out" ? "출금" : "입금"} ${amount}원  ${row.content || row.description || ""}`);
    for (const [path, value] of matched.slice(0, 4)) console.log(`      ${path} = ${value}`);
  }
  if (hits.length > 10) console.log(`  ... 그 밖에 ${hits.length - 10}건`);
}
console.log("");

/* ── 5. 원본 한 건 ────────────────────────────────────────────────────── */
if (showSample) {
  console.log("── 원본 한 건 (필드 이름 확인용) ──");
  console.log(JSON.stringify(rows[0], null, 2));
}

process.exit(0);
