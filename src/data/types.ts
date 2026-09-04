/* 도메인 타입 정의 */

export type Role = "staff" | "manager" | "admin";
export type EmploymentType = "fullTime" | "partTime";
export type SalaryType = "monthly" | "hourly" | "perSlot";
export type ShiftPeriod = "morning" | "afternoon";
export type Department = "hall" | "kitchen";
export type WorkDayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface WeeklyWorkDay {
  useDefault?: boolean;
  off?: boolean;
  start?: string;
  end?: string;
}

export type WeeklyWorkSchedule = Partial<Record<WorkDayKey, WeeklyWorkDay>>;
export type ManagerPermissionKey =
  | "dashboard"
  | "reservations"
  | "scheduleManage"
  | "employees"
  | "sales"
  | "vendors"
  | "inventory"
  | "settlements"
  | "recipes"
  | "notices"
  | "guide";

export type ManagerPermissions = Record<ManagerPermissionKey, boolean>;

export type ResvStatus =
  | "예약확정"
  | "방문완료"
  | "취소"
  | "노쇼"
  | "단체"
  | "확인전화필요"
  | "예약대기";

export type Seat = string;

export type PunchStatus = "before" | "working" | "done";

export interface Reservation {
  id: number;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  name: string;
  phone: string;
  people: number;
  seat: Seat;
  request?: string;
  status: ResvStatus;
  memo?: string;
  writer: string;
  createdAt: string;
}

export interface Employee {
  id: number;
  name: string;
  role: string;
  roleLabel?: string;
  employmentType: EmploymentType;
  salaryType: SalaryType;
  hourly: number; // 시급
  monthlySalary?: number;
  socialInsurance?: boolean; // 4대보험 근로자 부담 공제 적용 여부
  slotRate?: number; // 오전/오후 슬롯 1회당 수당
  standardStart?: string;
  standardEnd?: string;
  weeklyScheduleEnabled?: boolean;
  weeklySchedule?: WeeklyWorkSchedule;
  // 회원가입(자가 등록) 직원 정보
  phone?: string;
  address?: string;
  residentRegistrationNumber?: string;
  bank?: string;
  account?: string; // 계좌번호
  uid?: string; // 연결된 Firebase Auth uid
}

export interface ShiftAssignment {
  id: string;
  date: string; // YYYY-MM-DD
  dayIndex: number; // 0=월 ... 6=일
  period: ShiftPeriod;
  department: Department;
  employeeId: number;
  employeeName: string;
  roleLabel?: string; // 사장, 점장, 팀장, 실장 등
  order: number; // 같은 칸 안 표시 순서
  start?: string;
  end?: string;
  breakMin?: number;
}

export interface Shift extends ShiftAssignment {
  /** 기존 데이터/규칙 호환용 alias */
  empId: number;
  /** 기존 화면 호환용 alias */
  day: number; // 0=월 ... 6=일
  off?: boolean;
}

export interface WorkRecord {
  id: number;
  empId: number;
  date: string;
  periods?: ShiftPeriod[];
  departments?: Department[];
  slotSummary?: string;
  workType?: "slot" | "time";
  planStart: string;
  planEnd: string;
  actualStart?: string;
  actualEnd?: string;
  breakMin: number;
  note?: string;
  handover?: string;
  checklist?: boolean[];
  status: "미작성" | "제출" | "승인대기" | "승인완료";
}

export type PayrollAdjustmentType = "extra" | "deduct";

export interface PayrollAdjustment {
  id: string;
  type: PayrollAdjustmentType;
  amount: number;
  memo?: string;
  createdAt?: string;
}

export interface PayrollRow {
  empId: number;
  month?: string; // YYYY-MM
  morningCount?: number;
  afternoonCount?: number;
  slotCount?: number;
  slotRate?: number;
  manualAdjust?: number;
  payMode?: SalaryType;
  hours: number;
  base: number;
  extra: number;
  deduct: number;
  adjustments?: PayrollAdjustment[];
  note?: string;
  status: "승인대기" | "검토중" | "승인완료";
  normalH: number;
  overH: number;
  holidayH: number;
  nightH: number;
  editedRecords: number;
}

export type OwnerScheduleCategory = "personal" | "store" | "meeting" | "finance" | "other";

export interface OwnerSchedule {
  id: number;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime?: string; // HH:mm
  title: string;
  category: OwnerScheduleCategory;
  location?: string;
  memo?: string;
  important?: boolean;
  done?: boolean;
  repeat?: boolean;
  repeatCycle?: "monthly" | "yearly";
  createdAt?: string;
  updatedAt?: string;
}

export interface Notice {
  id: number;
  docId?: string;
  text: string;
  date: string;
  pinned?: boolean;
}

export interface Vendor {
  id: number;
  name: string;
  businessNumber: string;
  address: string;
  contactName?: string;
  phone?: string;
  email?: string;
  bank?: string;
  account?: string;
  memo?: string;
  active?: boolean;
  createdAt?: string;
}

export type InventoryCategory = string;
export type StorageType = "냉장" | "냉동" | "실온" | "기타";

export interface InventoryCategoryItem {
  id: string;
  name: string;
  color?: string;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface InventoryItem {
  id: number;
  vendorId: number;
  name: string;
  category: InventoryCategory;
  storageType: StorageType;
  unit: string;
  currentQty: number;
  minQty: number;
  defaultOrderQty: number;
  unitPrice: number;
  memo?: string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type PurchaseOrderStatus = "draft" | "ordered" | "received" | "canceled";
export type SettlementStatus = "unsettled" | "settled";
export type SettlementMethod = "bank" | "cash" | "card" | "other";

export interface PurchaseOrderItem {
  inventoryItemId: number;
  name: string;
  qty: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
}

export interface PurchaseOrder {
  id: number;
  vendorId: number;
  vendorName: string;
  status: PurchaseOrderStatus;
  items: PurchaseOrderItem[];
  totalAmount: number;
  memo?: string;
  createdAt: string;
  orderedAt?: string;
  receivedAt?: string;
  createdBy?: string;
  settlementStatus?: SettlementStatus;
  settledAt?: string; // YYYY-MM-DD
  settlementMethod?: SettlementMethod;
  settlementMemo?: string;
}

export type StockLogType = "in" | "out" | "adjust" | "waste";

export interface StockLog {
  id: string;
  inventoryItemId: number;
  type: StockLogType;
  qty: number;
  beforeQty: number;
  afterQty: number;
  memo?: string;
  createdAt: string;
  createdBy?: string;
  purchaseOrderId?: number;
}

export interface RecipeIngredient {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  unitCost: number;
  vendorId?: number;
}

export interface Recipe {
  id: number;
  name: string;
  category: string;
  servings: number;
  ingredients: RecipeIngredient[];
  laborCost: number;
  overheadCost: number;
  salePrice: number;
  memo?: string;
  active?: boolean;
  createdAt?: string;
}

export type SalesOrderStatus = "paid" | "canceled" | "refunded" | "partialRefund" | "voided";

export interface SalesOrderItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  category?: string;
}

export interface SalesPayment {
  method: "card" | "cash" | "simplePay" | "voucher" | "other";
  amount: number;
}

export interface SalesOrder {
  id: string;
  okposOrderId: string;
  businessDate: string; // YYYY-MM-DD
  soldAt: string; // ISO or display timestamp
  status: SalesOrderStatus;
  totalAmount: number;
  discountAmount: number;
  paidAmount: number;
  refundAmount: number;
  paymentMethods: SalesPayment[];
  items: SalesOrderItem[];
  tableName?: string;
  orderType?: "dineIn" | "takeout" | "delivery" | "other";
  source?: "okpos" | "manual" | "mock";
  syncedAt?: string;
}

export interface SalesDailySummary {
  id: string;
  businessDate: string;
  orderCount: number;
  canceledCount: number;
  grossAmount: number;
  discountAmount: number;
  refundAmount: number;
  netAmount: number;
  averageOrderAmount: number;
  paymentTotals: SalesPayment[];
  syncedAt?: string;
  /**
   * 주문 건수를 **아는 날인가.**
   *
   * 네이버 플레이스플러스는 순매출 숫자 하나만 준다 — 건수가 없다. `orderCount` 를
   * 0 으로 읽고 화면에 «0건»이라 적으면 사람은 그것을 사실로 믿는다. 안 적힌 것과
   * 0 은 다르다.
   */
  hasOrderCount?: boolean;
  /** 어디서 온 숫자인가. `ownervista` 면 오너비스타가 넣어 준 것이다. */
  source?: string | null;
  sourceLabel?: string | null;
}

/** 매출 내 메뉴 한 줄. 네이버 스마트플레이스 「매출 내 메뉴 비중」이 원본이다. */
export interface SalesMenuShare {
  /** 네이버가 준 메뉴 id. 이름이 바뀌어도 같은 메뉴를 이을 수 있는 유일한 값이다. */
  menuId: string;
  menuName: string;
  categoryName: string | null;
  /** 이 기간 매출(원). */
  sales: number;
  /**
   * 전체 매출에서 차지하는 비중(%). **네이버가 준 값 그대로다.**
   *
   * 메뉴 합계로 다시 나누면 안 된다 — 전체 매출에는 메뉴로 안 잡히는 것이 섞여
   * 있어서, 다시 나누면 64.5% 가 89% 로 부풀어 오른다.
   */
  sharePercent: number;
}

/**
 * 매출 내 메뉴 비중 최신본. **한 장뿐이다.**
 *
 * 오너비스타가 네이버 플레이스플러스에서 받아 넘겨 준다. **기간 합계다. 날짜별이
 * 아니다** — 그래서 `SalesDailySummary` 에 끼우지 않고 따로 둔다. 화면이 묻는 것은
 * 「요즘 무엇이 많이 팔렸나」라 합계로 충분하다.
 */
export interface SalesMenuReport {
  id: string;
  startDate: string;
  endDate: string;
  /** 그 기간 전체 순매출. 메뉴 합계와 다를 수 있다 — 메뉴로 안 잡힌 매출이 있다. */
  overallSales: number;
  /** 많이 판 순서. */
  menus: SalesMenuShare[];
  /** 오너비스타가 네이버에서 받은 때. 오래된 것은 오래됐다고 말해야 한다. */
  collectedAt?: string;
  /** 우리가 오너비스타에서 받은 때. */
  syncedAt?: string;
  source?: string | null;
  sourceLabel?: string | null;
}

export interface SalesSyncRun {
  id: string;
  startedAt: string;
  finishedAt?: string;
  status: "success" | "failed" | "config_required" | "skipped";
  importedCount: number;
  updatedCount: number;
  rangeStart: string;
  rangeEnd: string;
  message?: string;
}

export interface GranterSyncRun {
  id: string;
  startedAt: string;
  finishedAt?: string;
  status: "success" | "failed" | "config_required" | "skipped";
  importedCount: number;
  updatedCount: number;
  matchedCount: number;
  cardImportedCount?: number;
  cardUpdatedCount?: number;
  accountImportedCount?: number;
  accountUpdatedCount?: number;
  ignoredCount?: number;
  rangeStart: string;
  rangeEnd: string;
  message?: string;
}

export type GranterFinanceDomain = "card" | "account";
export type GranterFinanceCategoryKind = "sales" | "purchase" | "payroll" | "fixedExpense" | "other";

export interface GranterFinanceItem {
  id: string;
  granterTicketId: string;
  ticketType: string;
  domain: GranterFinanceDomain;
  transactedAt: string;
  businessDate: string;
  amount: number;
  transactionType: string;
  direction: "in" | "out";
  content: string;
  description: string;
  status: string;
  isIncluded: boolean;
  assetId: number | null;
  contactId: number | null;
  contactName: string;
  detail: Record<string, unknown> | null;
  categoryId?: string | null;
  categoryName?: string;
  classifiedAt?: string;
  classifiedBy?: string;
  syncedAt?: string;
}

export interface GranterFinanceCategory {
  id: string;
  name: string;
  domain: GranterFinanceDomain;
  color: string;
  sortOrder: number;
  kind?: GranterFinanceCategoryKind;
  createdAt?: string;
  updatedAt?: string;
}

export type FinanceCloseStatus = "draft" | "closed";

export interface FinanceDailyClose {
  id: string; // YYYY-MM-DD
  date: string;
  cashSales: number;
  transferSales: number;
  otherSales: number;
  memo?: string;
  status: FinanceCloseStatus;
  closedAt?: string;
  closedBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type FinanceMatchKind = "purchasePayment" | "salesDeposit";

export interface FinanceMatch {
  id: string;
  kind: FinanceMatchKind;
  purchaseOrderIds: number[];
  cardItemIds: string[];
  accountItemIds: string[];
  amount: number;
  memo?: string;
  createdAt: string;
  createdBy?: string;
}

export const RESV_STATUSES: ResvStatus[] = [
  "예약확정", "방문완료", "취소", "노쇼", "단체", "확인전화필요", "예약대기",
];

export const SEATS: Seat[] = ["홀A", "홀B", "홀C", "룸1", "룸2", "창가", "단체석"];
