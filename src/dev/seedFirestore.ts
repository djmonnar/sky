/* ============================================================
   개발용 Firestore 초기 데이터 seed

   - 관리자(admin) 계정으로 로그인한 상태에서만 실행 가능
     (Security Rules가 admin 쓰기만 허용하므로 staff는 거부됨)
   - employees 컬렉션에 데이터가 이미 있으면 중복 생성하지 않음
   - 실행 방법:
     1) 관리자 대시보드의 "초기 데이터 넣기" 버튼 (직원 데이터 없을 때 표시)
     2) 개발 모드 브라우저 콘솔에서 window.seedFirestore()
   ============================================================ */

import {
  collection, doc, getDocs, writeBatch, serverTimestamp, limit, query,
} from "firebase/firestore";
import { requireDb, STORE_ID } from "../lib/firebase";
import {
  EMPLOYEES, SEED_RESERVATIONS, SEED_SHIFTS, SEED_RECORDS,
  SEED_PAYROLL, SEED_NOTICES, SEED_HANDOVERS,
} from "../data/mock";

export async function seedFirestore(): Promise<string> {
  const db = requireDb();
  const base = ["stores", STORE_ID] as const;
  const colRef = (name: string) => collection(db, ...base, name);

  // 중복 생성 방지: 직원 데이터가 하나라도 있으면 건너뜀
  const existing = await getDocs(query(colRef("employees"), limit(1)));
  if (!existing.empty) {
    return "이미 데이터가 있어 seed를 건너뛰었습니다.";
  }

  const batch = writeBatch(db);
  const ts = () => ({ createdAt: serverTimestamp(), updatedAt: serverTimestamp() });

  batch.set(doc(db, "stores", STORE_ID), { name: "하늘땅", ...ts() });

  EMPLOYEES.forEach((e) =>
    batch.set(doc(colRef("employees"), String(e.id)), { ...e, active: true, ...ts() })
  );
  SEED_RESERVATIONS.forEach((r) =>
    // 도메인 createdAt(접수일시 문자열)은 유지하고 updatedAt만 타임스탬프
    batch.set(doc(colRef("reservations"), String(r.id)), { ...r, updatedAt: serverTimestamp() })
  );
  SEED_SHIFTS.forEach((s) =>
    batch.set(doc(colRef("shifts"), `${s.empId}_${s.day}`), { ...s, ...ts() })
  );
  SEED_RECORDS.forEach((r) =>
    batch.set(doc(colRef("workRecords"), String(r.id)), { ...r, ...ts() })
  );
  SEED_PAYROLL.forEach((p) =>
    batch.set(doc(colRef("payroll"), String(p.empId)), { ...p, month: "2026-06", ...ts() })
  );
  SEED_NOTICES.forEach((n) =>
    batch.set(doc(colRef("notices"), String(n.id)), { ...n, ...ts() })
  );
  SEED_HANDOVERS.forEach((h) =>
    batch.set(doc(colRef("handovers"), String(h.id)), {
      ...h, createdBy: "seed", createdAt: serverTimestamp(),
    })
  );

  await batch.commit();
  return `seed 완료: 직원 ${EMPLOYEES.length} · 예약 ${SEED_RESERVATIONS.length} · 근무표 ${SEED_SHIFTS.length} 외`;
}

// 개발 모드에서 콘솔 실행 지원
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { seedFirestore: typeof seedFirestore }).seedFirestore = seedFirestore;
}
