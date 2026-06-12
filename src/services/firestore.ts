/* ============================================================
   Firestore 데이터 서비스

   컬렉션 구조: stores/{STORE_ID}/{reservations|shifts|workRecords|
                payroll|notices|handovers|employees|attendanceLogs}

   - 문서 ID 규칙
     reservations / workRecords / notices : String(도메인 숫자 id)
     shifts  : `${empId}_${day}`
     payroll : String(empId)
     handovers / attendanceLogs : 자동 ID (addDoc)
   - 정렬은 클라이언트에서 수행 (복합 인덱스 불필요)
   ============================================================ */

import {
  collection, doc, query, where, onSnapshot,
  setDoc, updateDoc, addDoc, serverTimestamp,
  type QueryConstraint, type DocumentData,
} from "firebase/firestore";
import { requireDb, STORE_ID } from "../lib/firebase";
import type {
  Reservation, Employee, Shift, WorkRecord, PayrollRow, Notice,
} from "../data/types";
import type { AttendanceLogDoc } from "../types/firestore";

function col(name: string) {
  return collection(requireDb(), "stores", STORE_ID, name);
}

type Unsub = () => void;
type ErrCb = (e: Error) => void;

function subscribe<T>(
  name: string,
  map: (data: DocumentData, id: string) => T,
  cb: (items: T[]) => void,
  onError: ErrCb,
  ...constraints: QueryConstraint[]
): Unsub {
  const q = constraints.length ? query(col(name), ...constraints) : col(name);
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => map(d.data(), d.id))),
    (e) => onError(new Error(`${name}: ${e.message}`))
  );
}

/* ---------- 구독 (실시간) ---------- */

export function subscribeEmployees(cb: (v: Employee[]) => void, onError: ErrCb): Unsub {
  return subscribe(
    "employees",
    (d, id) => ({
      id: Number(d.id ?? id),
      name: d.name ?? "",
      role: d.role ?? "",
      hourly: d.hourly ?? 0,
    }),
    (items) => cb(items.sort((a, b) => a.id - b.id)),
    onError
  );
}

/** Firestore Timestamp 등 비문자열 값을 표시용 문자열로 정규화 */
function asDisplayDate(raw: unknown): string {
  if (typeof raw === "string") return raw;
  const maybe = raw as { toDate?: () => Date } | null | undefined;
  if (maybe && typeof maybe.toDate === "function") {
    const dt = maybe.toDate();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
  }
  return "";
}

export function subscribeReservations(cb: (v: Reservation[]) => void, onError: ErrCb): Unsub {
  return subscribe(
    "reservations",
    (d, id) => ({
      ...(d as Reservation),
      id: Number(d.id ?? id),
      createdAt: asDisplayDate(d.createdAt),
    }),
    (items) => cb(items.sort((a, b) => a.time.localeCompare(b.time))),
    onError
  );
}

/** empId를 주면 본인 것만 구독 (staff), 없으면 전체 (admin) */
export function subscribeShifts(
  empId: number | undefined,
  cb: (v: Shift[]) => void,
  onError: ErrCb
): Unsub {
  const cons = empId !== undefined ? [where("empId", "==", empId)] : [];
  return subscribe(
    "shifts",
    (d) => d as Shift,
    (items) => cb(items.sort((a, b) => a.empId - b.empId || a.day - b.day)),
    onError,
    ...cons
  );
}

export function subscribeRecords(
  empId: number | undefined,
  cb: (v: WorkRecord[]) => void,
  onError: ErrCb
): Unsub {
  const cons = empId !== undefined ? [where("empId", "==", empId)] : [];
  return subscribe(
    "workRecords",
    (d, id) => ({ ...(d as WorkRecord), id: Number(d.id ?? id) }),
    (items) => cb(items.sort((a, b) => a.date.localeCompare(b.date))),
    onError,
    ...cons
  );
}

export function subscribePayroll(cb: (v: PayrollRow[]) => void, onError: ErrCb): Unsub {
  return subscribe(
    "payroll",
    (d) => d as PayrollRow,
    (items) => cb(items.sort((a, b) => a.empId - b.empId)),
    onError
  );
}

export function subscribeNotices(cb: (v: Notice[]) => void, onError: ErrCb): Unsub {
  return subscribe(
    "notices",
    (d, id) => ({ ...(d as Notice), id: Number(d.id ?? id) }),
    (items) => cb(items.sort((a, b) => b.id - a.id)),
    onError
  );
}

export function subscribeHandovers(cb: (v: Notice[]) => void, onError: ErrCb): Unsub {
  return subscribe(
    "handovers",
    (d, id) => ({ id: Number(d.id ?? Date.parse(id) ?? 0), text: d.text ?? "", date: d.date ?? "" }),
    (items) => cb(items.sort((a, b) => b.id - a.id)),
    onError
  );
}

/* ---------- 쓰기 ---------- */

export async function fsUpsertReservation(r: Reservation): Promise<void> {
  await setDoc(
    doc(col("reservations"), String(r.id)),
    { ...r, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function fsSetShift(s: Shift): Promise<void> {
  await setDoc(
    doc(col("shifts"), `${s.empId}_${s.day}`),
    { ...s, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function fsAddRecord(r: WorkRecord): Promise<void> {
  await setDoc(doc(col("workRecords"), String(r.id)), {
    ...r,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function fsApproveRecord(id: number): Promise<void> {
  await updateDoc(doc(col("workRecords"), String(id)), {
    status: "승인완료",
    updatedAt: serverTimestamp(),
  });
}

export async function fsUpdatePayroll(
  empId: number,
  patch: Partial<PayrollRow>
): Promise<void> {
  await setDoc(
    doc(col("payroll"), String(empId)),
    { ...patch, empId, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function fsAddHandover(n: Notice, createdBy: string): Promise<void> {
  await addDoc(col("handovers"), {
    ...n,
    createdBy,
    createdAt: serverTimestamp(),
  });
}

export async function fsAddAttendanceLog(
  log: Omit<AttendanceLogDoc, "createdAt">
): Promise<void> {
  await addDoc(col("attendanceLogs"), {
    ...log,
    createdAt: serverTimestamp(),
  });
}
