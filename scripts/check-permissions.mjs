/**
 * 매니저·실무자 권한 점검 (브라우저·Firebase 없이 실행)
 *
 *   npm run test:permissions
 *
 * src/config/staffPermissions.ts 를 esbuild 로 묶어 불러온 뒤, 역할마다 어떤 화면이 열리는지
 * (관리자 전부·매니저는 매니저 권한·실무자는 실무자 권한), 실무자가 예약 지우기(reservations)를
 * 받을 길이 없는지, 화면의 열쇠와 Firestore 규칙의 열쇠가 같은지 본다.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildSync } from "esbuild";

const dir = mkdtempSync(join(tmpdir(), "permissions-"));
const outfile = join(dir, "staffPermissions.mjs");
buildSync({
  entryPoints: [new URL("../src/config/staffPermissions.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile,
  logLevel: "silent",
});
const sp = await import(pathToFileURL(outfile).href);
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

const results = [];
function check(label, fn) {
  try {
    fn();
    results.push(`✅ ${label}`);
  } catch (error) {
    results.push(`❌ ${label}\n   ${error.message}`);
    process.exitCode = 1;
  }
}

const MANAGER_ALL_OFF = {
  dashboard: true, reservations: false, scheduleManage: false, employees: false, sales: false, vendors: false,
  inventory: false, settlements: false, recipes: false, notices: false, guide: false,
};
const STAFF_KEYS = Object.keys(sp.DEFAULT_STAFF_PERMISSIONS);

check("실무자 권한은 처음엔 전부 꺼짐 — 문서가 없거나 이상한 값이면 꺼짐", () => {
  assert.ok(STAFF_KEYS.every((key) => sp.DEFAULT_STAFF_PERMISSIONS[key] === false));
  assert.deepEqual(sp.normalizeStaffPermissions(null), sp.DEFAULT_STAFF_PERMISSIONS);
  const odd = sp.normalizeStaffPermissions({ inventory: "true", recipes: 1, notices: true, reservations: true });
  assert.equal(odd.inventory, false, "문자 true 는 켠 것이 아니다");
  assert.equal(odd.recipes, false);
  assert.equal(odd.notices, true);
  assert.equal("reservations" in odd, false, "모르는 열쇠는 버린다");
});

check("실무자 열쇠에 대시보드·예약(지우기)이 없다 — 실무자 기본 화면은 끌 수도 넓힐 수도 없다", () => {
  assert.ok(!STAFF_KEYS.includes("dashboard"));
  assert.ok(!STAFF_KEYS.includes("reservations"));
  assert.deepEqual(sp.STAFF_PERMISSION_OPTIONS.map((option) => option.key), STAFF_KEYS);
  assert.ok(sp.STAFF_PERMISSION_OPTIONS.every((option) => !option.locked));
  assert.deepEqual(sp.STAFF_BASE_FEATURES.map((feature) => feature.label), ["대시보드", "오늘 예약", "근무표", "근무기록", "체크리스트"]);
  assert.match(sp.STAFF_PERMISSION_OPTIONS.find((option) => option.key === "employees").description, /개인정보/);
});

check("roleCan — 관리자 전부, 매니저는 매니저 권한, 실무자는 실무자 권한만", () => {
  const staff = sp.normalizeStaffPermissions({ inventory: true });
  const manager = { ...MANAGER_ALL_OFF, recipes: true };
  assert.equal(sp.roleCan("admin", "sales", MANAGER_ALL_OFF, sp.DEFAULT_STAFF_PERMISSIONS), true);
  assert.equal(sp.roleCan("manager", "recipes", manager, staff), true);
  assert.equal(sp.roleCan("manager", "inventory", manager, staff), false, "실무자 권한은 매니저에게 안 간다");
  assert.equal(sp.roleCan("staff", "inventory", manager, staff), true);
  assert.equal(sp.roleCan("staff", "recipes", manager, staff), false, "매니저 권한은 실무자에게 안 간다");
  assert.equal(sp.roleCan("staff", "reservations", { ...manager, reservations: true }, staff), false, "실무자는 reservations 열쇠로 못 연다");
  assert.equal(sp.roleCan("staff", "dashboard", manager, staff), false);
});

check("규칙 — 실무자 권한 문서의 칸이 화면의 열쇠와 같다(하나라도 다르면 저장이 거절된다)", () => {
  const block = rules.slice(rules.indexOf("function validStaffPermissions()"), rules.indexOf("function isStaff(storeId)"));
  for (const key of STAFF_KEYS) assert.match(block, new RegExp(`request\\.resource\\.data\\.${key} is bool`), key);
  const listed = [...block.matchAll(/"([A-Za-z]+)"/g)].map((match) => match[1]).filter((key) => key !== "updatedAt");
  assert.deepEqual(listed.sort(), [...STAFF_KEYS].sort());
});

check("규칙 — 각 관리 권한에 실무자도 같은 열쇠로 들어가고, 예약 지우기에는 안 들어간다", () => {
  const fn = (name) => {
    const start = rules.indexOf(`function ${name}(storeId)`);
    return rules.slice(start, rules.indexOf("}", start));
  };
  const expected = {
    canManageSchedule: ["scheduleManage"],
    canManageEmployees: ["employees"],
    canManageSales: ["sales"],
    canManageFinance: ["sales", "settlements"],
    canManageVendors: ["vendors"],
    canReadVendors: ["vendors", "inventory", "settlements", "recipes"],
    canManageInventory: ["inventory", "vendors"],
    canManagePurchaseOrders: ["vendors", "inventory", "settlements"],
    canManageRecipes: ["recipes"],
    canManageNotices: ["notices"],
  };
  for (const [name, keys] of Object.entries(expected)) {
    const body = fn(name);
    for (const key of keys) assert.match(body, new RegExp(`granted\\(storeId, "${key}"\\)`), `${name} ← ${key}`);
    assert.ok(!/managerCan\(/.test(body), `${name} 는 granted 로 본다(매니저·실무자 함께)`);
  }
  assert.match(fn("canManageReservations"), /managerCan\(storeId, "reservations"\)/);
  assert.ok(!/granted|staffCan/.test(fn("canManageReservations")), "예약 지우기는 실무자 권한으로 안 열린다");
  assert.match(rules, /\(isAdmin\(storeId\) \|\| isStaff\(storeId\)\)\s*&& docId == "staffPermissions"/, "실무자는 읽기만");
  assert.match(rules, /isAdmin\(storeId\)\s*&& docId == "staffPermissions"\s*&& validStaffPermissions\(\)/, "쓰기는 관리자만");
});

console.log(results.join("\n"));
console.log(process.exitCode ? "\n실패한 검사가 있습니다." : "\n모든 검사를 통과했습니다.");
