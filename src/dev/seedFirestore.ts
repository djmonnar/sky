/* ============================================================
   Firestore 초기 데이터 seed / reset

   - 관리자(admin) 계정으로 로그인한 상태에서만 실행 가능
     (Security Rules가 admin 쓰기만 허용)
   - seedFirestore(): 비어 있을 때만 1회 시드 (중복 방지)
   - resetFirestore(): 슬롯 모델 데이터로 전체 재설정
     (users/auth는 건드리지 않음 — 로그인 계정 유지)
   - 실행: 관리자 대시보드 버튼, 또는 개발 콘솔 window.seedFirestore()/resetFirestore()
   ============================================================ */

import {
  collection, doc, getDocs, writeBatch, serverTimestamp, limit, query,
} from "firebase/firestore";
import { requireDb, STORE_ID } from "../lib/firebase";
import {
  EMPLOYEES, SEED_RESERVATIONS, SEED_SHIFTS, SEED_RECORDS,
  SEED_PAYROLL, SEED_NOTICES, SEED_HANDOVERS,
} from "../data/mock";

// attendanceLogs는 규칙상 삭제 불가(출퇴근 로그 불변)이므로 재설정 대상에서 제외
const COLLECTIONS = [
  "employees", "reservations", "shifts", "workRecords",
  "payroll", "notices", "handovers",
];

/** 슬롯 문서 id: 날짜_슬롯_구역_직원 (직원은 한 칸에 최대 1회) */
function shiftDocId(s: { date: string; period: string; department: string; employeeId: number }): string {
  return `${s.date}_${s.period}_${s.department}_${s.employeeId}`;
}

function buildSeedBatches(db: ReturnType<typeof requireDb>) {
  const base = ["stores", STORE_ID] as const;
  const colRef = (name: string) => collection(db, ...base, name);
  const ts = () => ({ createdAt: serverTimestamp(), updatedAt: serverTimestamp() });

  // writeBatch는 500 ops 제한 → 컬렉션 단위로 나눠 커밋
  const ops: (() => void)[] = [];
  const batch = writeBatch(db);

  batch.set(doc(db, "stores", STORE_ID), { name: "하늘땅", ...ts() });

  EMPLOYEES.forEach((e) =>
    ops.push(() => batch.set(doc(colRef("employees"), String(e.id)), { ...e, active: true, ...ts() }))
  );
  SEED_RESERVATIONS.forEach((r) =>
    ops.push(() => batch.set(doc(colRef("reservations"), String(r.id)), { ...r, updatedAt: serverTimestamp() }))
  );
  SEED_SHIFTS.forEach((s) =>
    ops.push(() => batch.set(doc(colRef("shifts"), shiftDocId(s)), { ...s, id: shiftDocId(s), empId: s.employeeId, day: s.dayIndex, ...ts() }))
  );
  SEED_RECORDS.forEach((r) =>
    ops.push(() => batch.set(doc(colRef("workRecords"), String(r.id)), { ...r, ...ts() }))
  );
  SEED_PAYROLL.forEach((p) =>
    ops.push(() => batch.set(doc(colRef("payroll"), String(p.empId)), { ...p, ...ts() }))
  );
  SEED_NOTICES.forEach((n) =>
    ops.push(() => batch.set(doc(colRef("notices"), String(n.id)), { ...n, ...ts() }))
  );
  SEED_HANDOVERS.forEach((h) =>
    ops.push(() => batch.set(doc(colRef("handovers"), String(h.id)), { ...h, createdBy: "seed", createdAt: serverTimestamp() }))
  );

  // 직원번호 카운터: 다음 회원가입은 max(id)+1 부터
  const maxId = EMPLOYEES.reduce((m, e) => Math.max(m, e.id), 0);
  ops.push(() => batch.set(doc(colRef("meta"), "employeeCounter"), { value: maxId, updatedAt: serverTimestamp() }));

  return { batch, ops };
}

export async function seedFirestore(): Promise<string> {
  const db = requireDb();
  const base = ["stores", STORE_ID] as const;
  const colRef = (name: string) => collection(db, ...base, name);

  const existing = await getDocs(query(colRef("employees"), limit(1)));
  if (!existing.empty) {
    return "이미 데이터가 있어 seed를 건너뛰었습니다. (재설정은 resetFirestore 사용)";
  }

  const { batch, ops } = buildSeedBatches(db);
  ops.forEach((op) => op());
  await batch.commit();
  return `seed 완료: 직원 ${EMPLOYEES.length} · 슬롯 ${SEED_SHIFTS.length} · 예약 ${SEED_RESERVATIONS.length}`;
}

/** 슬롯 모델로 전체 재설정. 기존 데이터(users 제외)를 지우고 다시 시드 */
export async function resetFirestore(): Promise<string> {
  const db = requireDb();
  const base = ["stores", STORE_ID] as const;
  const colRef = (name: string) => collection(db, ...base, name);

  // 1) 기존 문서 삭제 (컬렉션별 배치)
  let deleted = 0;
  for (const name of COLLECTIONS) {
    const snap = await getDocs(colRef(name));
    // 500개 단위로 나눠 삭제
    for (let i = 0; i < snap.docs.length; i += 450) {
      const chunk = snap.docs.slice(i, i + 450);
      const delBatch = writeBatch(db);
      chunk.forEach((d) => delBatch.delete(d.ref));
      await delBatch.commit();
      deleted += chunk.length;
    }
  }

  // 2) 슬롯 데이터로 재시드 (450개 단위)
  const base2 = ["stores", STORE_ID] as const;
  const colRef2 = (name: string) => collection(db, ...base2, name);
  const ts = () => ({ createdAt: serverTimestamp(), updatedAt: serverTimestamp() });

  type Write = { ref: ReturnType<typeof doc>; data: Record<string, unknown> };
  const writes: Write[] = [];
  writes.push({ ref: doc(db, "stores", STORE_ID), data: { name: "하늘땅", ...ts() } });
  EMPLOYEES.forEach((e) => writes.push({ ref: doc(colRef2("employees"), String(e.id)), data: { ...e, active: true, ...ts() } }));
  SEED_RESERVATIONS.forEach((r) => writes.push({ ref: doc(colRef2("reservations"), String(r.id)), data: { ...r, updatedAt: serverTimestamp() } }));
  SEED_SHIFTS.forEach((s) => writes.push({ ref: doc(colRef2("shifts"), shiftDocId(s)), data: { ...s, id: shiftDocId(s), empId: s.employeeId, day: s.dayIndex, ...ts() } }));
  SEED_RECORDS.forEach((r) => writes.push({ ref: doc(colRef2("workRecords"), String(r.id)), data: { ...r, ...ts() } }));
  SEED_PAYROLL.forEach((p) => writes.push({ ref: doc(colRef2("payroll"), String(p.empId)), data: { ...p, ...ts() } }));
  SEED_NOTICES.forEach((n) => writes.push({ ref: doc(colRef2("notices"), String(n.id)), data: { ...n, ...ts() } }));
  SEED_HANDOVERS.forEach((h) => writes.push({ ref: doc(colRef2("handovers"), String(h.id)), data: { ...h, createdBy: "seed", createdAt: serverTimestamp() } }));
  const maxId = EMPLOYEES.reduce((m, e) => Math.max(m, e.id), 0);
  writes.push({ ref: doc(colRef2("meta"), "employeeCounter"), data: { value: maxId, updatedAt: serverTimestamp() } });

  for (let i = 0; i < writes.length; i += 450) {
    const chunk = writes.slice(i, i + 450);
    const b = writeBatch(db);
    chunk.forEach((w) => b.set(w.ref, w.data));
    await b.commit();
  }

  return `재설정 완료: ${deleted}건 삭제 → 직원 ${EMPLOYEES.length} · 슬롯 ${SEED_SHIFTS.length} · 예약 ${SEED_RESERVATIONS.length} 재생성`;
}

// 개발 모드에서 콘솔 실행 지원
if (import.meta.env.DEV && typeof window !== "undefined") {
  const w = window as unknown as { seedFirestore: typeof seedFirestore; resetFirestore: typeof resetFirestore };
  w.seedFirestore = seedFirestore;
  w.resetFirestore = resetFirestore;
}
