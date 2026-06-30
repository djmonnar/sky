/* ============================================================
   Firestore 데이터 서비스

   컬렉션 구조: stores/{STORE_ID}/{reservations|shifts|workRecords|
                payroll|notices|handovers|employees|attendanceLogs}

   - 문서 ID 규칙
     reservations / workRecords / notices : String(도메인 숫자 id)
     shifts  : `${date}_${period}_${department}_${employeeId}_${order}`
     payroll : String(empId)
     handovers / attendanceLogs : 자동 ID (addDoc)
   - 정렬은 클라이언트에서 수행 (복합 인덱스 불필요)
   ============================================================ */

import {
  collection, doc, query, where, onSnapshot,
  setDoc, updateDoc, addDoc, deleteDoc, getDoc, serverTimestamp, writeBatch,
  type QueryConstraint, type DocumentData,
} from "firebase/firestore";
import { requireAuth, requireDb, STORE_ID } from "../lib/firebase";
import type {
  Department, Reservation, Employee, Shift, ShiftPeriod, WorkRecord, PayrollRow, Notice, Role,
  Vendor, InventoryCategoryItem, InventoryItem, PurchaseOrder, StockLog, Recipe, SalesOrder, SalesSyncRun, SalesPayment,
  OwnerSchedule,
} from "../data/types";
import type { AttendanceLogDoc, UserProfileDoc } from "../types/firestore";
import { PERIOD_TIME, sortShifts } from "../lib/shifts";

function col(name: string) {
  return collection(requireDb(), "stores", STORE_ID, name);
}

function usersCol() {
  return collection(requireDb(), "users");
}

function metaDoc(id: string) {
  return doc(requireDb(), "stores", STORE_ID, "meta", id);
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
      roleLabel: d.roleLabel,
      employmentType: d.employmentType ?? (d.salaryType === "monthly" || d.monthlySalary ? "fullTime" : "partTime"),
      salaryType: d.salaryType ?? (d.monthlySalary ? "monthly" : d.slotRate ? "perSlot" : "hourly"),
      hourly: d.hourly ?? 0,
      monthlySalary: d.monthlySalary,
      slotRate: d.slotRate,
      standardStart: d.standardStart,
      standardEnd: d.standardEnd,
      phone: d.phone,
      address: d.address,
      residentRegistrationNumber: d.residentRegistrationNumber,
      bank: d.bank,
      account: d.account,
      uid: d.uid,
    }),
    (items) => cb(items.sort((a, b) => a.id - b.id)),
    onError
  );
}

export function subscribeUserProfiles(cb: (v: UserProfileDoc[]) => void, onError: ErrCb): Unsub {
  return onSnapshot(
    query(usersCol(), where("storeId", "==", STORE_ID)),
    (snap) => cb(
      snap.docs
        .map((d) => ({ uid: d.id, ...(d.data() as Omit<UserProfileDoc, "uid">) }))
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
    ),
    (e) => onError(new Error(`users: ${e.message}`))
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

function inferPeriod(d: DocumentData): ShiftPeriod {
  if (d.period === "morning" || d.period === "afternoon") return d.period;
  return typeof d.start === "string" && d.start >= "15:00" ? "afternoon" : "morning";
}

function normalizeShift(d: DocumentData, id: string): Shift {
  const period = inferPeriod(d);
  const employeeId = Number(d.employeeId ?? d.empId ?? 0);
  const dayIndex = Number(d.dayIndex ?? d.day ?? 0);
  return {
    id: String(d.id ?? id),
    date: d.date ?? "",
    dayIndex,
    day: dayIndex,
    period,
    department: (d.department === "kitchen" ? "kitchen" : "hall") as Department,
    employeeId,
    empId: employeeId,
    employeeName: d.employeeName ?? "",
    roleLabel: d.roleLabel,
    order: Number(d.order ?? 0),
    start: d.start ?? PERIOD_TIME[period].start,
    end: d.end ?? PERIOD_TIME[period].end,
    breakMin: d.breakMin ?? PERIOD_TIME[period].breakMin,
    off: d.off ?? false,
  };
}

/** empId를 주면 본인 것만 구독 (staff), 없으면 전체 (admin) */
export function subscribeShifts(
  empId: number | undefined,
  cb: (v: Shift[]) => void,
  onError: ErrCb
): Unsub {
  if (empId !== undefined) {
    const byEmployeeId = new Map<string, Shift>();
    const byEmpId = new Map<string, Shift>();
    const emit = () => {
      const merged = new Map<string, Shift>([...byEmpId, ...byEmployeeId]);
      cb([...merged.values()].sort(sortShifts));
    };
    const makeListener = (field: "employeeId" | "empId") =>
      onSnapshot(
        query(col("shifts"), where(field, "==", empId)),
        (snap) => {
          const target = field === "employeeId" ? byEmployeeId : byEmpId;
          target.clear();
          snap.docs.forEach((d) => target.set(d.id, normalizeShift(d.data(), d.id)));
          emit();
        },
        (e) => onError(new Error(`shifts: ${e.message}`))
      );

    const unsubEmployeeId = makeListener("employeeId");
    const unsubEmpId = makeListener("empId");
    return () => {
      unsubEmployeeId();
      unsubEmpId();
    };
  }

  return subscribe(
    "shifts",
    normalizeShift,
    (items) => cb(items.sort(sortShifts)),
    onError,
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
    (d, id) => ({ ...(d as Notice), id: Number(d.id ?? id), docId: id }),
    (items) => cb(items.sort((a, b) => b.id - a.id)),
    onError
  );
}

export function subscribeOwnerSchedules(cb: (v: OwnerSchedule[]) => void, onError: ErrCb): Unsub {
  return subscribe(
    "ownerSchedules",
    (d, id) => ({
      id: Number(d.id ?? id),
      date: String(d.date ?? ""),
      startTime: String(d.startTime ?? ""),
      endTime: d.endTime ? String(d.endTime) : "",
      title: String(d.title ?? ""),
      category: d.category === "store" || d.category === "meeting" || d.category === "finance" || d.category === "other"
        ? d.category
        : "personal",
      location: d.location ? String(d.location) : "",
      memo: d.memo ? String(d.memo) : "",
      important: d.important === true,
      done: d.done === true,
      createdAt: asDisplayDate(d.createdAt) || String(d.createdAt ?? ""),
      updatedAt: asDisplayDate(d.updatedAt) || String(d.updatedAt ?? ""),
    }),
    (items) => cb(items.sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`))),
    onError
  );
}

export function subscribeHandovers(cb: (v: Notice[]) => void, onError: ErrCb): Unsub {
  return subscribe(
    "handovers",
    (d, id) => ({ id: Number(d.id ?? Date.parse(id) ?? 0), docId: id, text: d.text ?? "", date: d.date ?? "" }),
    (items) => cb(items.sort((a, b) => b.id - a.id)),
    onError
  );
}

export function subscribeVendors(cb: (v: Vendor[]) => void, onError: ErrCb): Unsub {
  return subscribe(
    "vendors",
    (d, id) => ({
      ...(d as Vendor),
      id: Number(d.id ?? id),
      name: d.name ?? "",
      businessNumber: d.businessNumber ?? "",
      address: d.address ?? "",
      active: d.active ?? true,
    }),
    (items) => cb(items.sort((a, b) => a.name.localeCompare(b.name))),
    onError
  );
}

export function subscribeInventoryItems(cb: (v: InventoryItem[]) => void, onError: ErrCb): Unsub {
  return subscribe(
    "inventoryItems",
    (d, id) => ({
      ...(d as InventoryItem),
      id: Number(d.id ?? id),
      vendorId: Number(d.vendorId ?? 0),
      name: String(d.name ?? ""),
      category: d.category ?? "식재료",
      storageType: d.storageType ?? "실온",
      unit: String(d.unit ?? ""),
      currentQty: Number(d.currentQty ?? 0),
      minQty: Number(d.minQty ?? 0),
      defaultOrderQty: Number(d.defaultOrderQty ?? 0),
      unitPrice: Number(d.unitPrice ?? 0),
      active: d.active ?? true,
      createdAt: asDisplayDate(d.createdAt) || String(d.createdAt ?? ""),
      updatedAt: asDisplayDate(d.updatedAt) || String(d.updatedAt ?? ""),
    }),
    (items) => cb(items.sort((a, b) => a.vendorId - b.vendorId || a.name.localeCompare(b.name))),
    onError
  );
}

export function subscribeInventoryCategories(cb: (v: InventoryCategoryItem[]) => void, onError: ErrCb): Unsub {
  return subscribe(
    "inventoryCategories",
    (d, id) => ({
      id,
      name: String(d.name ?? ""),
      color: d.color ? String(d.color) : undefined,
      sortOrder: Number(d.sortOrder ?? 0),
      createdAt: asDisplayDate(d.createdAt) || String(d.createdAt ?? ""),
      updatedAt: asDisplayDate(d.updatedAt) || String(d.updatedAt ?? ""),
    }),
    (items) => cb(items.filter((item) => item.name).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name))),
    onError
  );
}

export function subscribePurchaseOrders(cb: (v: PurchaseOrder[]) => void, onError: ErrCb): Unsub {
  return subscribe(
    "purchaseOrders",
    (d, id) => ({
      id: Number(d.id ?? id),
      vendorId: Number(d.vendorId ?? 0),
      vendorName: String(d.vendorName ?? ""),
      status: d.status === "ordered" || d.status === "received" || d.status === "canceled" ? d.status : "draft",
      items: Array.isArray(d.items)
        ? d.items.map((item: DocumentData) => ({
            inventoryItemId: Number(item.inventoryItemId ?? 0),
            name: String(item.name ?? ""),
            qty: Number(item.qty ?? 0),
            unit: String(item.unit ?? ""),
            unitPrice: Number(item.unitPrice ?? 0),
            totalPrice: Number(item.totalPrice ?? 0),
          }))
        : [],
      totalAmount: Number(d.totalAmount ?? 0),
      memo: d.memo,
      createdAt: asDisplayDate(d.createdAt) || String(d.createdAt ?? ""),
      orderedAt: asDisplayDate(d.orderedAt) || String(d.orderedAt ?? ""),
      receivedAt: asDisplayDate(d.receivedAt) || String(d.receivedAt ?? ""),
      createdBy: d.createdBy,
    }),
    (items) => cb(items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)),
    onError
  );
}

export function subscribeRecipes(cb: (v: Recipe[]) => void, onError: ErrCb): Unsub {
  return subscribe(
    "recipes",
    (d, id) => ({
      ...(d as Recipe),
      id: Number(d.id ?? id),
      name: d.name ?? "",
      category: d.category ?? "",
      servings: Number(d.servings ?? 1),
      ingredients: Array.isArray(d.ingredients) ? d.ingredients : [],
      laborCost: Number(d.laborCost ?? 0),
      overheadCost: Number(d.overheadCost ?? 0),
      salePrice: Number(d.salePrice ?? 0),
      active: d.active ?? true,
    }),
    (items) => cb(items.sort((a, b) => a.name.localeCompare(b.name))),
    onError
  );
}

function normalizePaymentMethod(raw: unknown): SalesPayment["method"] {
  if (raw === "card" || raw === "cash" || raw === "simplePay" || raw === "voucher" || raw === "other") return raw;
  return "other";
}

export function subscribeSalesOrders(cb: (v: SalesOrder[]) => void, onError: ErrCb): Unsub {
  return subscribe(
    "salesOrders",
    (d, id) => ({
      id,
      okposOrderId: String(d.okposOrderId ?? id),
      businessDate: String(d.businessDate ?? ""),
      soldAt: asDisplayDate(d.soldAt) || String(d.soldAt ?? ""),
      status: d.status === "canceled" || d.status === "refunded" || d.status === "partialRefund" || d.status === "voided"
        ? d.status
        : "paid",
      totalAmount: Number(d.totalAmount ?? 0),
      discountAmount: Number(d.discountAmount ?? 0),
      paidAmount: Number(d.paidAmount ?? 0),
      refundAmount: Number(d.refundAmount ?? 0),
      paymentMethods: Array.isArray(d.paymentMethods)
        ? d.paymentMethods.map((p: DocumentData) => ({
            method: normalizePaymentMethod(p.method),
            amount: Number(p.amount ?? 0),
          }))
        : [],
      items: Array.isArray(d.items)
        ? d.items.map((item: DocumentData, index: number) => ({
            id: String(item.id ?? `${id}-${index}`),
            name: String(item.name ?? "메뉴"),
            quantity: Number(item.quantity ?? 0),
            unitPrice: Number(item.unitPrice ?? 0),
            totalAmount: Number(item.totalAmount ?? 0),
            category: item.category,
          }))
        : [],
      tableName: d.tableName,
      orderType: d.orderType,
      source: d.source ?? "okpos",
      syncedAt: asDisplayDate(d.syncedAt) || String(d.syncedAt ?? ""),
    }),
    (items) => cb(items.sort((a, b) => b.soldAt.localeCompare(a.soldAt))),
    onError
  );
}

export function subscribeSalesSyncRuns(cb: (v: SalesSyncRun[]) => void, onError: ErrCb): Unsub {
  return subscribe(
    "salesSyncRuns",
    (d, id) => ({
      id,
      startedAt: asDisplayDate(d.startedAt) || String(d.startedAt ?? ""),
      finishedAt: asDisplayDate(d.finishedAt) || String(d.finishedAt ?? ""),
      status: d.status === "success" || d.status === "failed" || d.status === "config_required" || d.status === "skipped"
        ? d.status
        : "failed",
      importedCount: Number(d.importedCount ?? 0),
      updatedCount: Number(d.updatedCount ?? 0),
      rangeStart: String(d.rangeStart ?? ""),
      rangeEnd: String(d.rangeEnd ?? ""),
      message: d.message,
    }),
    (items) => cb(items.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 20)),
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

export async function fsDeleteReservation(id: number): Promise<void> {
  await deleteDoc(doc(col("reservations"), String(id)));
}

export async function fsUpsertEmployee(e: Employee): Promise<void> {
  await setDoc(
    doc(col("employees"), String(e.id)),
    { ...e, active: true, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function fsDeleteEmployee(id: number): Promise<void> {
  await deleteDoc(doc(col("employees"), String(id)));
}

export async function fsUpsertVendor(v: Vendor): Promise<void> {
  await setDoc(
    doc(col("vendors"), String(v.id)),
    { ...v, active: v.active ?? true, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function fsDeleteVendor(id: number): Promise<void> {
  await deleteDoc(doc(col("vendors"), String(id)));
}

export async function fsUpsertInventoryItem(item: InventoryItem): Promise<void> {
  await setDoc(
    doc(col("inventoryItems"), String(item.id)),
    { ...item, active: item.active ?? true, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function fsDeleteInventoryItem(id: number): Promise<void> {
  await deleteDoc(doc(col("inventoryItems"), String(id)));
}

export async function fsUpsertInventoryCategory(category: InventoryCategoryItem): Promise<void> {
  await setDoc(
    doc(col("inventoryCategories"), category.id),
    {
      ...category,
      name: category.name.trim(),
      updatedAt: serverTimestamp(),
      ...(category.createdAt ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true }
  );
}

export async function fsDeleteInventoryCategory(id: string): Promise<void> {
  await deleteDoc(doc(col("inventoryCategories"), id));
}

export async function fsUpsertPurchaseOrder(order: PurchaseOrder): Promise<void> {
  await setDoc(
    doc(col("purchaseOrders"), String(order.id)),
    { ...order, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function fsDeletePurchaseOrder(id: number): Promise<void> {
  await deleteDoc(doc(col("purchaseOrders"), String(id)));
}

export async function fsReceivePurchaseOrder(
  order: PurchaseOrder,
  updatedItems: InventoryItem[],
  logs: StockLog[]
): Promise<void> {
  const batch = writeBatch(requireDb());
  updatedItems.forEach((item) => {
    batch.set(
      doc(col("inventoryItems"), String(item.id)),
      { ...item, active: item.active ?? true, updatedAt: serverTimestamp() },
      { merge: true }
    );
  });
  logs.forEach((log) => {
    batch.set(doc(col("stockLogs"), log.id), { ...log, createdAt: serverTimestamp() });
  });
  batch.set(
    doc(col("purchaseOrders"), String(order.id)),
    { ...order, status: "received", receivedAt: order.receivedAt ?? new Date().toISOString(), updatedAt: serverTimestamp() },
    { merge: true }
  );
  await batch.commit();
}

export async function fsUpsertRecipe(r: Recipe): Promise<void> {
  await setDoc(
    doc(col("recipes"), String(r.id)),
    { ...r, active: r.active ?? true, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function fsDeleteRecipe(id: number): Promise<void> {
  await deleteDoc(doc(col("recipes"), String(id)));
}

export async function fsSetShift(s: Shift): Promise<void> {
  await setDoc(
    doc(col("shifts"), s.id),
    { ...s, empId: s.employeeId, day: s.dayIndex, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function fsDeleteShift(id: string): Promise<void> {
  await deleteDoc(doc(col("shifts"), id));
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

export async function fsUpsertOwnerSchedule(item: OwnerSchedule): Promise<void> {
  await setDoc(
    doc(col("ownerSchedules"), String(item.id)),
    {
      ...item,
      title: item.title.trim(),
      location: item.location?.trim() ?? "",
      memo: item.memo?.trim() ?? "",
      updatedAt: serverTimestamp(),
      ...(item.createdAt ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true }
  );
}

export async function fsDeleteOwnerSchedule(id: number): Promise<void> {
  await deleteDoc(doc(col("ownerSchedules"), String(id)));
}

export async function fsGetPayrollPassword(): Promise<string> {
  const snap = await getDoc(metaDoc("payrollPassword"));
  const value = snap.exists() ? snap.data().value : null;
  return typeof value === "string" && value.length > 0 ? value : "qaz@qwer4312";
}

export async function fsSetPayrollPassword(nextPassword: string): Promise<void> {
  await setDoc(
    metaDoc("payrollPassword"),
    { value: nextPassword, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function fsUpsertNotice(n: Notice): Promise<void> {
  const docId = n.docId ?? String(n.id);
  await setDoc(
    doc(col("notices"), docId),
    { ...n, id: n.id, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function fsDeleteNotice(docId: string): Promise<void> {
  await deleteDoc(doc(col("notices"), docId));
}

export async function fsUpsertHandover(n: Notice, createdBy: string): Promise<void> {
  const docId = n.docId ?? String(n.id);
  await setDoc(
    doc(col("handovers"), docId),
    {
      ...n,
      id: n.id,
      createdBy,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function fsDeleteHandover(docId: string): Promise<void> {
  await deleteDoc(doc(col("handovers"), docId));
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

export async function fsUpdateUserRole(uid: string, role: Role): Promise<void> {
  await updateDoc(doc(requireDb(), "users", uid), {
    role,
    updatedAt: serverTimestamp(),
  });
}

export async function fsDeactivateUserProfile(uid: string): Promise<void> {
  await updateDoc(doc(requireDb(), "users", uid), {
    active: false,
    updatedAt: serverTimestamp(),
  });
}

export async function fsUpdateMyProfile(
  uid: string,
  employeeId: number | undefined,
  data: {
    name: string;
    phone: string;
    address: string;
    residentRegistrationNumber: string;
    bank: string;
    account: string;
  }
): Promise<void> {
  const patch = {
    name: data.name,
    phone: data.phone,
    address: data.address,
    residentRegistrationNumber: data.residentRegistrationNumber,
    bank: data.bank,
    account: data.account,
    updatedAt: serverTimestamp(),
  };
  await updateDoc(doc(requireDb(), "users", uid), patch);
  if (employeeId !== undefined) {
    await updateDoc(doc(col("employees"), String(employeeId)), patch);
  }
}

export async function fsSyncOkposSales(): Promise<{ ok: boolean; message: string; runId?: string }> {
  const user = requireAuth().currentUser;
  if (!user) throw new Error("로그인이 필요합니다.");
  const token = await user.getIdToken();
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const configuredUrl = import.meta.env.VITE_OKPOS_SYNC_FUNCTION_URL;
  const url = configuredUrl || `https://asia-northeast3-${projectId}.cloudfunctions.net/syncOkposSales`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ mode: "manual" }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.message || "매출 동기화 요청에 실패했습니다.");
  }
  return {
    ok: !!json.ok,
    message: String(json.message ?? "매출 동기화 요청이 완료되었습니다."),
    runId: json.runId,
  };
}
