/* 도메인 타입 정의 */

export type Role = "staff" | "manager" | "admin";
export type EmploymentType = "fullTime" | "partTime";
export type SalaryType = "monthly" | "hourly" | "perSlot";
export type ShiftPeriod = "morning" | "afternoon";
export type Department = "hall" | "kitchen";

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

export const RESV_STATUSES: ResvStatus[] = [
  "예약확정", "방문완료", "취소", "노쇼", "단체", "확인전화필요", "예약대기",
];

export const SEATS: Seat[] = ["홀A", "홀B", "홀C", "룸1", "룸2", "창가", "단체석"];
