/* 목업 시드 데이터 - 실서비스 전환 시 이 파일만 제거하면 됨 */

import { TODAY, TODAY_STR, fmtDate, weekDates } from "../lib/time";
import type {
  Department,
  Employee,
  InventoryCategoryItem,
  InventoryItem,
  Notice,
  PayrollRow,
  PurchaseOrder,
  Recipe,
  Reservation,
  SalesOrder,
  SalesSyncRun,
  Shift,
  ShiftPeriod,
  Vendor,
  WorkRecord,
} from "./types";

export const CURRENT_STAFF_ID = 5; // 로그인 세션 스텁: 김현지

export const EMPLOYEES: Employee[] = [
  { id: 1, name: "김지현", role: "홀", roleLabel: "사장", employmentType: "fullTime", salaryType: "monthly", hourly: 0, monthlySalary: 3800000, standardStart: "10:00", standardEnd: "22:00" },
  { id: 2, name: "박현제", role: "홀", roleLabel: "점장", employmentType: "fullTime", salaryType: "monthly", hourly: 0, monthlySalary: 3400000, standardStart: "10:00", standardEnd: "22:00" },
  { id: 3, name: "윤경원", role: "홀", roleLabel: "팀장", employmentType: "fullTime", salaryType: "monthly", hourly: 0, monthlySalary: 3100000, standardStart: "10:00", standardEnd: "22:00" },
  { id: 4, name: "박기빈", role: "홀", roleLabel: "실장", employmentType: "fullTime", salaryType: "monthly", hourly: 0, monthlySalary: 3000000, standardStart: "10:00", standardEnd: "22:00" },
  { id: 5, name: "김현지", role: "홀", employmentType: "partTime", salaryType: "hourly", hourly: 10500 },
  { id: 6, name: "옥수민", role: "홀", employmentType: "partTime", salaryType: "hourly", hourly: 10500 },
  { id: 7, name: "김영선", role: "홀", employmentType: "partTime", salaryType: "perSlot", hourly: 0, slotRate: 52000 },
  { id: 8, name: "윤정한", role: "홀", employmentType: "partTime", salaryType: "hourly", hourly: 10300 },
  { id: 9, name: "전덕민", role: "홀", employmentType: "partTime", salaryType: "perSlot", hourly: 0, slotRate: 50000 },
  { id: 10, name: "이성수", role: "홀", employmentType: "partTime", salaryType: "hourly", hourly: 10500 },
  { id: 11, name: "홍근우", role: "홀/주방", employmentType: "partTime", salaryType: "hourly", hourly: 11000 },
  { id: 12, name: "이다현", role: "홀", employmentType: "partTime", salaryType: "hourly", hourly: 10300 },
  { id: 13, name: "김승준", role: "홀", employmentType: "partTime", salaryType: "hourly", hourly: 10300 },
  { id: 14, name: "손유성", role: "홀", employmentType: "partTime", salaryType: "hourly", hourly: 10300 },
  { id: 15, name: "손유찬", role: "홀", employmentType: "partTime", salaryType: "hourly", hourly: 10300 },
  { id: 16, name: "이예지", role: "홀", employmentType: "partTime", salaryType: "hourly", hourly: 10300 },
  { id: 17, name: "이정현", role: "홀", employmentType: "partTime", salaryType: "hourly", hourly: 10300 },
  { id: 18, name: "혜영고모", role: "주방", employmentType: "fullTime", salaryType: "monthly", hourly: 0, monthlySalary: 2700000, standardStart: "10:00", standardEnd: "15:00" },
  { id: 19, name: "원봉덕", role: "주방", employmentType: "fullTime", salaryType: "monthly", hourly: 0, monthlySalary: 2700000, standardStart: "10:00", standardEnd: "15:00" },
  { id: 20, name: "박혜영", role: "주방", employmentType: "partTime", salaryType: "perSlot", hourly: 0, slotRate: 55000 },
  { id: 21, name: "박미경", role: "주방", employmentType: "partTime", salaryType: "hourly", hourly: 11000 },
  { id: 22, name: "차준형", role: "주방", employmentType: "partTime", salaryType: "hourly", hourly: 11000 },
];

export const SEED_RESERVATIONS: Reservation[] = [
  { id: 1, date: TODAY_STR, time: "11:30", name: "박지훈", phone: "010-1234-5678", people: 4, seat: "룸1", status: "예약확정", request: "창가 자리 선호", writer: "김현지", createdAt: "2026-06-10 14:25" },
  { id: 2, date: TODAY_STR, time: "12:00", name: "최수민", phone: "010-2345-6789", people: 12, seat: "단체석", status: "단체", request: "단체 회식, 미리 상차림 요청", writer: "박현제", createdAt: "2026-06-09 11:02", memo: "선결제 완료" },
  { id: 3, date: TODAY_STR, time: "12:30", name: "김도현", phone: "010-2468-1357", people: 2, seat: "창가", status: "방문완료", request: "성인 2, 아동 0", writer: "김현지", createdAt: "2026-06-10 14:25" },
  { id: 4, date: TODAY_STR, time: "13:00", name: "이서윤", phone: "010-3456-7890", people: 3, seat: "홀A", status: "확인전화필요", request: "유아의자 1개", writer: "박현제", createdAt: "2026-06-11 09:40" },
  { id: 5, date: TODAY_STR, time: "17:30", name: "강민재", phone: "010-4567-8901", people: 5, seat: "홀B", status: "예약확정", writer: "김현지", createdAt: "2026-06-11 18:12" },
  { id: 6, date: TODAY_STR, time: "18:00", name: "윤지아", phone: "010-5678-9012", people: 8, seat: "룸2", status: "단체", request: "생일 모임, 케이크 반입", writer: "박현제", createdAt: "2026-06-08 16:33" },
  { id: 7, date: TODAY_STR, time: "18:30", name: "한상우", phone: "010-6789-0123", people: 2, seat: "홀C", status: "예약대기", writer: "김현지", createdAt: "2026-06-12 09:05" },
  { id: 8, date: TODAY_STR, time: "19:00", name: "오세린", phone: "010-7890-1234", people: 4, seat: "홀A", status: "예약확정", request: "주차 안내 필요", writer: "박현제", createdAt: "2026-06-11 13:20" },
  { id: 9, date: TODAY_STR, time: "19:30", name: "임준호", phone: "010-8901-2345", people: 2, seat: "창가", status: "취소", memo: "개인 사정으로 취소", writer: "김현지", createdAt: "2026-06-10 10:15" },
  { id: 10, date: TODAY_STR, time: "20:00", name: "송예진", phone: "010-9012-3456", people: 6, seat: "룸1", status: "확인전화필요", request: "룸 희망, 인원 변동 가능", writer: "박현제", createdAt: "2026-06-11 20:48" },
  { id: 11, date: TODAY_STR, time: "20:30", name: "백승호", phone: "010-1357-2468", people: 3, seat: "홀B", status: "노쇼", writer: "김현지", createdAt: "2026-06-07 12:00" },
  { id: 12, date: TODAY_STR, time: "21:00", name: "조은별", phone: "010-2469-1358", people: 2, seat: "홀C", status: "예약확정", writer: "김현지", createdAt: "2026-06-12 08:30" },
];

const EMPLOYEE_BY_ID = new Map(EMPLOYEES.map((e) => [e.id, e]));
const WEEK = weekDates(TODAY);
const PERIOD_TIME: Record<ShiftPeriod, { start: string; end: string; breakMin: number }> = {
  morning: { start: "10:00", end: "15:00", breakMin: 30 },
  afternoon: { start: "17:00", end: "22:00", breakMin: 30 },
};

type SlotSeed = Record<ShiftPeriod, Record<Department, number[]>>;

const WEEK_PLAN: SlotSeed[] = [
  {
    morning: { hall: [1, 2, 3, 5, 7, 8, 9, 10], kitchen: [18, 11] },
    afternoon: { hall: [1, 2, 3, 5, 8, 4, 9, 11, 10], kitchen: [20, 21] },
  },
  {
    morning: { hall: [2, 3, 4, 5, 6, 8, 7], kitchen: [19, 11] },
    afternoon: { hall: [3, 4, 5, 6, 8, 12, 9, 14], kitchen: [20, 21] },
  },
  {
    morning: { hall: [1, 2, 3, 5, 6, 7, 10, 14], kitchen: [19] },
    afternoon: { hall: [1, 2, 3, 5, 6, 4, 10, 14], kitchen: [20, 21] },
  },
  {
    morning: { hall: [2, 1, 4, 6, 13, 7, 10], kitchen: [19, 11] },
    afternoon: { hall: [1, 4, 6, 13, 7, 10, 11, 15], kitchen: [20, 21] },
  },
  {
    morning: { hall: [1, 2, 3, 6, 7, 12, 9, 10], kitchen: [19, 11] },
    afternoon: { hall: [1, 2, 3, 6, 11, 12, 9, 13, 16], kitchen: [20, 21] },
  },
  {
    morning: { hall: [1, 2, 4, 15, 6, 13, 9, 12], kitchen: [19, 11] },
    afternoon: { hall: [1, 2, 4, 15, 6, 13, 9, 12, 14, 17], kitchen: [22, 11] },
  },
  {
    morning: { hall: [1, 4, 3, 5, 13, 9, 12, 15, 10, 14], kitchen: [19, 11] },
    afternoon: { hall: [1, 4, 3, 5, 13, 9, 12, 14, 10, 15, 16, 17], kitchen: [22, 11] },
  },
];

function shift(dayIndex: number, period: ShiftPeriod, department: Department, employeeId: number, order: number): Shift {
  const employee = EMPLOYEE_BY_ID.get(employeeId);
  const date = fmtDate(WEEK[dayIndex]);
  const time = PERIOD_TIME[period];
  return {
    id: `${date}_${period}_${department}_${employeeId}_${order}`,
    date,
    dayIndex,
    day: dayIndex,
    period,
    department,
    employeeId,
    empId: employeeId,
    employeeName: employee?.name ?? `직원 ${employeeId}`,
    roleLabel: employee?.roleLabel,
    order,
    ...time,
  };
}

export const SEED_SHIFTS: Shift[] = WEEK_PLAN.flatMap((dayPlan, dayIndex) =>
  (["morning", "afternoon"] as ShiftPeriod[]).flatMap((period) =>
    (["hall", "kitchen"] as Department[]).flatMap((department) =>
      dayPlan[period][department].map((employeeId, order) =>
        shift(dayIndex, period, department, employeeId, order)
      )
    )
  )
);

export const SEED_RECORDS: WorkRecord[] = [
  { id: 1, empId: 5, date: fmtDate(WEEK[0]), periods: ["morning"], departments: ["hall"], slotSummary: "오전 · 홀", workType: "slot", planStart: "10:00", planEnd: "15:00", actualStart: "10:00", actualEnd: "15:00", breakMin: 30, status: "승인완료" },
  { id: 2, empId: 5, date: fmtDate(WEEK[1]), periods: ["morning", "afternoon"], departments: ["hall"], slotSummary: "오전+오후 · 홀", workType: "slot", planStart: "10:00", planEnd: "22:00", actualStart: "10:00", actualEnd: "22:10", breakMin: 60, status: "승인완료", note: "마감 정리 10분 연장" },
  { id: 3, empId: 7, date: fmtDate(WEEK[2]), periods: ["morning"], departments: ["hall"], slotSummary: "오전 · 홀", workType: "slot", planStart: "10:00", planEnd: "15:00", actualStart: "10:05", actualEnd: "15:00", breakMin: 30, status: "승인대기", note: "버스 지연" },
  { id: 4, empId: 20, date: fmtDate(WEEK[3]), periods: ["afternoon"], departments: ["kitchen"], slotSummary: "오후 · 주방", workType: "slot", planStart: "17:00", planEnd: "22:00", actualStart: "17:00", actualEnd: "22:00", breakMin: 30, status: "승인대기" },
  { id: 5, empId: 11, date: fmtDate(WEEK[4]), periods: ["morning", "afternoon"], departments: ["hall", "kitchen"], slotSummary: "오전+오후 · 홀/주방", workType: "slot", planStart: "10:00", planEnd: "22:00", actualStart: "10:00", actualEnd: "22:00", breakMin: 60, status: "제출" },
];

function payrollRow(employee: Employee): PayrollRow {
  const assigned = SEED_SHIFTS.filter((s) => s.employeeId === employee.id);
  const morningCount = assigned.filter((s) => s.period === "morning").length;
  const afternoonCount = assigned.filter((s) => s.period === "afternoon").length;
  const slotCount = morningCount + afternoonCount;
  const hours = employee.salaryType === "hourly" ? slotCount * 5 : 0;
  const base = employee.salaryType === "monthly"
    ? employee.monthlySalary ?? 0
    : employee.salaryType === "perSlot"
      ? slotCount * (employee.slotRate ?? 0)
      : hours * employee.hourly;

  return {
    empId: employee.id,
    month: TODAY_STR.slice(0, 7),
    morningCount,
    afternoonCount,
    slotCount,
    slotRate: employee.slotRate,
    manualAdjust: 0,
    payMode: employee.salaryType,
    hours,
    base,
    extra: employee.id === 11 ? 30000 : 0,
    deduct: employee.id === 7 ? 10000 : 0,
    status: employee.id % 5 === 0 ? "검토중" : employee.id % 4 === 0 ? "승인완료" : "승인대기",
    normalH: hours,
    overH: 0,
    holidayH: 0,
    nightH: employee.salaryType === "hourly" ? Math.max(0, afternoonCount - 3) : 0,
    editedRecords: employee.id === 7 || employee.id === 11 ? 1 : 0,
  };
}

export const SEED_PAYROLL: PayrollRow[] = EMPLOYEES.map(payrollRow);

export const SEED_NOTICES: Notice[] = [
  { id: 1, text: "6월 셋째 주 위생점검 예정 - 주방/홀 청소 체크리스트 필수 확인", date: "06-11", pinned: true },
  { id: 2, text: "신메뉴 '들깨 칼국수' 6월 15일 출시, 레시피 교육 참석 필수", date: "06-10", pinned: true },
  { id: 3, text: "포스기 영수증 용지 발주 완료 - 수요일 입고 예정", date: "06-09" },
  { id: 4, text: "에어컨 필터 교체 완료, 이상 시 매니저에게 보고", date: "06-08" },
];

export const SEED_HANDOVERS: Notice[] = [
  { id: 1, text: "12시 단체 예약 룸 1세팅 먼저 부탁드립니다.", date: "06-12" },
  { id: 2, text: "유아의자 1개 13시 예약 테이블에 미리 준비해주세요.", date: "06-12" },
  { id: 3, text: "창가 쪽 블라인드 수리 접수했습니다. 당분간 수동 조작입니다.", date: "06-11" },
  { id: 4, text: "마감 시 식기세척기 필터 청소 꼭 확인 부탁드립니다.", date: "06-11" },
];

export const SEED_VENDORS: Vendor[] = [
  {
    id: 1,
    name: "하늘식자재",
    businessNumber: "123-45-67890",
    address: "광주광역시 북구 샘플로 12",
    contactName: "김담당",
    phone: "062-000-0000",
    memo: "채소/공산품 주 거래처",
    active: true,
  },
  {
    id: 2,
    name: "땅푸드",
    businessNumber: "234-56-78901",
    address: "광주광역시 서구 예시로 8",
    contactName: "박담당",
    phone: "062-111-1111",
    memo: "육류 납품",
    active: true,
  },
];

export const SEED_INVENTORY_CATEGORIES: InventoryCategoryItem[] = [
  { id: "food", name: "식재료", color: "#6f9157", sortOrder: 0 },
  { id: "meat", name: "육류", color: "#d96b4c", sortOrder: 1 },
  { id: "vegetable", name: "채소", color: "#5f8f4e", sortOrder: 2 },
  { id: "seafood", name: "수산", color: "#4d89a6", sortOrder: 3 },
  { id: "dry", name: "공산품", color: "#b78a3d", sortOrder: 4 },
  { id: "drink", name: "주류/음료", color: "#6d7eb8", sortOrder: 5 },
  { id: "supplies", name: "소모품", color: "#81776a", sortOrder: 6 },
  { id: "other", name: "기타", color: "#8f887b", sortOrder: 99 },
];

export const SEED_RECIPES: Recipe[] = [
  {
    id: 1,
    name: "샘플 김치찌개",
    category: "찌개",
    servings: 4,
    salePrice: 32000,
    laborCost: 3000,
    overheadCost: 2000,
    memo: "원가계산 예시 레시피",
    active: true,
    ingredients: [
      { id: "pork", name: "돼지고기", quantity: 0.6, unit: "kg", unitCost: 12000, vendorId: 2 },
      { id: "kimchi", name: "김치", quantity: 1, unit: "kg", unitCost: 4500, vendorId: 1 },
      { id: "tofu", name: "두부", quantity: 2, unit: "모", unitCost: 1200, vendorId: 1 },
    ],
  },
];

export const SEED_INVENTORY_ITEMS: InventoryItem[] = [
  {
    id: 1,
    vendorId: 1,
    name: "김치",
    category: "식재료",
    storageType: "냉장",
    unit: "kg",
    currentQty: 8,
    minQty: 10,
    defaultOrderQty: 20,
    unitPrice: 4500,
    memo: "찌개/반찬 공용",
    active: true,
  },
  {
    id: 2,
    vendorId: 1,
    name: "두부",
    category: "식재료",
    storageType: "냉장",
    unit: "모",
    currentQty: 18,
    minQty: 12,
    defaultOrderQty: 24,
    unitPrice: 1200,
    active: true,
  },
  {
    id: 3,
    vendorId: 2,
    name: "돼지고기",
    category: "육류",
    storageType: "냉장",
    unit: "kg",
    currentQty: 4,
    minQty: 6,
    defaultOrderQty: 10,
    unitPrice: 12000,
    active: true,
  },
];

export const SEED_PURCHASE_ORDERS: PurchaseOrder[] = [
  {
    id: 1,
    vendorId: 1,
    vendorName: "하늘식자재",
    status: "draft",
    createdAt: `${TODAY_STR}T09:00:00+09:00`,
    totalAmount: 90000,
    memo: "데모 발주서",
    items: [
      { inventoryItemId: 1, name: "김치", qty: 20, unit: "kg", unitPrice: 4500, totalPrice: 90000 },
    ],
  },
];

export const SEED_SALES_ORDERS: SalesOrder[] = [
  {
    id: `okpos-${TODAY_STR}-1001`,
    okposOrderId: `OK-${TODAY_STR}-1001`,
    businessDate: TODAY_STR,
    soldAt: `${TODAY_STR}T11:42:00+09:00`,
    status: "paid",
    totalAmount: 68000,
    discountAmount: 0,
    paidAmount: 68000,
    refundAmount: 0,
    paymentMethods: [{ method: "card", amount: 68000 }],
    items: [
      { id: "m-001", name: "들깨 칼국수", quantity: 2, unitPrice: 12000, totalAmount: 24000, category: "식사" },
      { id: "m-002", name: "수육", quantity: 1, unitPrice: 32000, totalAmount: 32000, category: "요리" },
      { id: "m-003", name: "음료", quantity: 4, unitPrice: 3000, totalAmount: 12000, category: "음료" },
    ],
    tableName: "홀A",
    orderType: "dineIn",
    source: "mock",
    syncedAt: `${TODAY_STR}T11:45:00+09:00`,
  },
  {
    id: `okpos-${TODAY_STR}-1002`,
    okposOrderId: `OK-${TODAY_STR}-1002`,
    businessDate: TODAY_STR,
    soldAt: `${TODAY_STR}T13:05:00+09:00`,
    status: "paid",
    totalAmount: 156000,
    discountAmount: 6000,
    paidAmount: 150000,
    refundAmount: 0,
    paymentMethods: [{ method: "card", amount: 100000 }, { method: "cash", amount: 50000 }],
    items: [
      { id: "m-010", name: "단체 정식", quantity: 12, unitPrice: 13000, totalAmount: 156000, category: "단체" },
    ],
    tableName: "룸1",
    orderType: "dineIn",
    source: "mock",
    syncedAt: `${TODAY_STR}T13:08:00+09:00`,
  },
  {
    id: `okpos-${TODAY_STR}-1003`,
    okposOrderId: `OK-${TODAY_STR}-1003`,
    businessDate: TODAY_STR,
    soldAt: `${TODAY_STR}T18:26:00+09:00`,
    status: "canceled",
    totalAmount: 42000,
    discountAmount: 0,
    paidAmount: 0,
    refundAmount: 42000,
    paymentMethods: [{ method: "card", amount: 42000 }],
    items: [
      { id: "m-004", name: "전골", quantity: 1, unitPrice: 42000, totalAmount: 42000, category: "요리" },
    ],
    tableName: "홀B",
    orderType: "dineIn",
    source: "mock",
    syncedAt: `${TODAY_STR}T18:30:00+09:00`,
  },
  {
    id: `okpos-${TODAY_STR}-1004`,
    okposOrderId: `OK-${TODAY_STR}-1004`,
    businessDate: TODAY_STR,
    soldAt: `${TODAY_STR}T19:31:00+09:00`,
    status: "paid",
    totalAmount: 92000,
    discountAmount: 0,
    paidAmount: 92000,
    refundAmount: 0,
    paymentMethods: [{ method: "simplePay", amount: 92000 }],
    items: [
      { id: "m-002", name: "수육", quantity: 2, unitPrice: 32000, totalAmount: 64000, category: "요리" },
      { id: "m-001", name: "들깨 칼국수", quantity: 2, unitPrice: 12000, totalAmount: 24000, category: "식사" },
      { id: "m-003", name: "음료", quantity: 1, unitPrice: 4000, totalAmount: 4000, category: "음료" },
    ],
    tableName: "창가",
    orderType: "dineIn",
    source: "mock",
    syncedAt: `${TODAY_STR}T19:35:00+09:00`,
  },
];

export const SEED_SALES_SYNC_RUNS: SalesSyncRun[] = [
  {
    id: `sync-${TODAY_STR}-sample`,
    startedAt: `${TODAY_STR}T19:35:00+09:00`,
    finishedAt: `${TODAY_STR}T19:35:02+09:00`,
    status: "success",
    importedCount: SEED_SALES_ORDERS.length,
    updatedCount: 0,
    rangeStart: `${TODAY_STR}T00:00:00+09:00`,
    rangeEnd: `${TODAY_STR}T23:59:59+09:00`,
    message: "데모 매출 샘플",
  },
];

export const CHECKLIST_TEMPLATE = [
  "오픈 준비 (테이블 세팅, 집기 확인, 메뉴판 점검)",
  "냉장/냉동 온도 기록",
  "예약 테이블 사전 세팅 확인",
  "재료 소진 품목 매니저 보고",
  "마감 청소 (홀 바닥, 주방 정리, 분리수거)",
];
