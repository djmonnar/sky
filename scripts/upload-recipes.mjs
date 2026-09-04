/**
 * 엑셀에서 옮긴 레시피(src/data/seed/haneulttang-recipes.json)를 Firestore 에 넣는다.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=<서비스계정.json> node scripts/upload-recipes.mjs [--dry-run]
 *
 * 이미 같은 이름의 레시피가 있으면 건드리지 않는다 — 사장님이 손본 것을 덮으면 안 된다.
 * id 는 지금 있는 것 다음 번호부터 매긴다.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(new URL("../functions/package.json", import.meta.url));
const admin = require("firebase-admin");

const STORE_ID = process.env.STORE_ID || "haneulttang";
const dryRun = process.argv.includes("--dry-run");

admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();
const col = db.collection("stores").doc(STORE_ID).collection("recipes");

const seed = JSON.parse(readFileSync(new URL("../src/data/seed/haneulttang-recipes.json", import.meta.url), "utf8"));
const existing = (await col.get()).docs.map((doc) => ({ docId: doc.id, ...doc.data() }));
console.log(`기존 레시피 ${existing.length}개:`, existing.map((r) => `${r.name}(#${r.id})`).join(", ") || "없음");

const taken = new Set(existing.map((r) => String(r.name ?? "").trim()));
let nextId = Math.max(0, ...existing.map((r) => Number(r.id) || 0)) + 1;
const plan = [];
for (const recipe of seed) {
  if (taken.has(recipe.name)) { console.log(`  건너뜀(이미 있음): ${recipe.name}`); continue; }
  plan.push({ ...recipe, id: nextId++ });
}
console.log(`${dryRun ? "넣을 예정" : "넣는 중"}: ${plan.length}개 → ${plan.map((r) => `${r.name}(#${r.id})`).join(", ")}`);
if (dryRun) process.exit(0);

const now = new Date().toISOString();
let batch = db.batch();
let count = 0;
for (const recipe of plan) {
  batch.set(col.doc(String(recipe.id)), {
    ...recipe,
    createdAt: now,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  if (++count % 400 === 0) { await batch.commit(); batch = db.batch(); }
}
await batch.commit();
console.log(`완료: ${plan.length}개 저장`);
