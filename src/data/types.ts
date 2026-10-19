/* 도메인 타입 정의 */

export type Role = "staff" | "manager" | "admin";
export type EmploymentType = "fullTime" | "partTime";
export type SalaryType = "monthly" | "hourly" | "perSlot";
export type ShiftPeriod = "morning" | "afternoon";
export type Department = "hall" | "kitchen";
export type WorkDayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/**
 * 챗봇이 늘 참고하는 «업체 기억». 관리자만 쓰고, 모든 대화의 시스템 지시에 실린다.
 * 예: "주차는 건물 뒤 공영주차장 2시간 무료", "단체는 10인 이상부터".
 */
export interface ChatbotMemory {
  id: string;
  text: string;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** 지난 대화 한 건. 로그인 사용자별로 따로 쌓인다. */
export interface ChatConversation {
  id: string;
  uid: string;
  title: string;
  messages: { role: "user" | "model"; text: string }[];
  createdAt?: string;
  updatedAt?: string;
}

/** 카카오 챗봇 사용자. 문서 ID = 카카오 botUserKey (슬래시는 _ 로 치환). */
export interface ChatbotUser {
  id: string;
  name: string;
  role: Role;
  employeeId?: number;
  active: boolean;
  memo?: string;
  /** 표시용 등록/수정 시각. 같은 이름이 여럿일 때 누가 언제 등록됐는지 가른다. */
  createdAt?: string;
  updatedAt?: string;
}

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

export type PunchStatus = "before" | "working" | "onBreak" | "done";

/** 출퇴근 기록의 종류. 휴게는 시작/종료가 짝을 이룬다. */
export type AttendanceType = "in" | "out" | "breakStart" | "breakEnd";

export interface AttendanceLog {
  id: string;
  empId: number;
  date: string;
  type: AttendanceType;
  time: string;
  /**
   * 저장된 순서 (epoch ms). 시각 문자열로 정렬하면 자정을 넘긴 퇴근("01:30")이
   * 출근("18:00")보다 앞서 버린다. 저장 순서가 곧 실제 순서다.
   */
  createdAt?: number;
}

export interface TimesheetSubmission {
  id: string;
  empId: number;
  empName: string;
  month: string;
  status: "제출" | "확인완료";
  workedDays: number;
  totalMinutes: number;
  breakMinutes: number;
  note?: string;
  submittedAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

/** 오늘 하루치 출퇴근 기록을 한 눈에 본 것. attendanceLogs 에서 계산한다. */
export interface AttendanceDay {
  date: string;
  empId: number;
  status: PunchStatus;
  inAt: string | null;
  outAt: string | null;
  /** 끝나지 않은 휴게는 end 가 null 이다. */
  breaks: { start: string; end: string | null }[];
  /** 끝난 휴게의 합 (분). 진행 중인 휴게는 빼지 않는다. */
  breakMinutes: number;
  /** 출근~퇴근에서 휴게를 뺀 시간 (분). 퇴근 전이면 지금까지. */
  workedMinutes: number;
}

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
  /** g · kg · ml · L · 박스 · ea 중 하나 (src/data/units.ts). */
  unit: string;
  /** 위 단위 1개당 원가(원). kg 이면 kg 당, g 이면 g 당. */
  unitCost: number;
  vendorId?: number;
  /** 엑셀에서 그대로 옮긴 수량 메모 등, 숫자로 못 옮긴 것. */
  note?: string;
  /**
   * 다른 레시피를 재료로 넣은 줄이면 그 레시피 id (된장찌개 안의 된장육수).
   * 이 줄의 단가는 저장값을 믿지 않고 그 레시피 원가 ÷ 산출량으로 매번 다시 계산한다
   * (src/lib/recipeCost.ts). 저장값은 카톡 챗봇처럼 그 계산을 모르는 곳을 위한 스냅숏이다.
   * 단위는 산출량 계열(ml·L, g·kg …)이거나 «회분»(한 번 만든 양 전체).
   */
  subRecipeId?: number;
}

/**
 * 판매 메뉴인가, 기본 상차림인가.
 *
 * 돼지갈비처럼 판매가가 있는 것만 원가율이 나온다. 김반찬·겉절이·쌈장 같은
 * 기본 상차림은 판매가가 없다 — 원가만 본다. 둘을 한 표에 섞으면 상차림
 * 원가율이 0% 로 찍혀 «마진 100%» 로 읽힌다.
 */
export type RecipeKind = "menu" | "side";

export interface Recipe {
  id: number;
  name: string;
  category: string;
  kind: RecipeKind;
  /** 이 재료 분량으로 몇 인분(제공 회수)이 나오는가. */
  servings: number;
  /**
   * 한 번 만들면 얼마가 나오는가 — 육수·소스처럼 다른 레시피에 들어가는 것에 적는다.
   * 「된장육수 2L」라고 적어 두어야 된장찌개에서 「300ml」로 넣을 수 있다. 0 이면 없음.
   */
  yieldQuantity?: number;
  /** 산출량 단위 (g · kg · ml · L · ea · 박스). 빈 문자열이면 없음. */
  yieldUnit?: string;
  ingredients: RecipeIngredient[];
  /** 판매가(원). 기본 상차림은 0. */
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
  /** 어디서 온 숫자인가. `ownervista` 면 오너비스타가 넣어 준 것이고, `okpos` 면 OK포스 엑셀이다. */
  source?: string | null;
  sourceLabel?: string | null;
  /**
   * 사장님이 올린 OK포스 「일자별(일별종합)」 엑셀의 그날 줄. **있으면 이게 그날 매출이다.**
   *
   * 네이버 플레이스플러스는 현금·상품권을 못 읽어 온다. OK포스는 매장에서 받은 결제
   * 전부라 이게 가장 정확하다. 그래서 불러올 때 netAmount 등을 이 값으로 바꿔 둔다
   * (src/lib/okposDaily.ts `withOkpos`) — 화면·합계는 따로 신경 쓸 것이 없다.
   *
   * 같은 문서의 다른 칸에 둔다. 네이버 동기화는 netAmount 칸을 merge 로 덮어쓰므로,
   * 거기 쓰면 다음 동기화 때 네이버 숫자로 되돌아간다.
   */
  okpos?: OkposDailyReport | null;
  /** 네이버가 준 그날 숫자. OK포스가 덮어쓴 날에도 비교하려고 남겨 둔다. 없으면 null. */
  naverNetAmount?: number | null;
}

/** OK포스 엑셀 「결제수단」 칸들. 엑셀 칸 이름을 그대로 옮겼다. */
export interface OkposPayments {
  /** 단순현금 */
  simpleCash: number;
  /** 현금영수 (현금영수증 발행한 현금) */
  cashReceipt: number;
  /** 신용카드 */
  card: number;
  /** 외상 */
  credit: number;
  /** 상품권 */
  voucher: number;
  /** 식권 */
  mealTicket: number;
  /** 회원포인트 */
  memberPoint: number;
  /** 제휴카드 */
  partnerCard: number;
  /** 사원카드 */
  employeeCard: number;
  /** 모바일쿠폰 */
  mobileCoupon: number;
  /** 캐시비 */
  cashbee: number;
  /** 전자상품권 */
  eVoucher: number;
  /** 온라인결제 */
  onlinePay: number;
  /** 기타결제 */
  otherPay: number;
}

/** OK포스 「일자별(일별종합)」 엑셀의 하루치 줄 */
export interface OkposDailyReport {
  businessDate: string;
  /** 총매출 */
  grossAmount: number;
  /** 총할인 */
  discountAmount: number;
  /** 실매출 — 그날 매출로 쓰는 숫자 */
  netAmount: number;
  /** 가액 (부가세 뺀 금액) */
  supplyAmount: number;
  /** 부가세 */
  vatAmount: number;
  /** 영수건수 */
  receiptCount: number;
  /** 고객수 */
  customerCount: number;
  /** 결제합계 */
  paymentTotal: number;
  payments: OkposPayments;
  /**
   * 결제합계 − 엑셀에 칸이 있는 결제수단 합.
   *
   * OK포스 「일자별(일별종합)」에는 결제수단이 14칸 있는데, 그걸 다 더해도 결제합계에
   * 매일 수십만 원씩 모자란다(2026-10 엑셀: 18일 합계 1,135만 원). 칸이 없는 결제수단이
   * 있다는 뜻이다. **무엇인지는 엑셀로 알 수 없다** — 지어내지 않고 이 이름으로 둔다.
   */
  unlistedPayment: number;
  /** 할인내역 중 0 이 아닌 것 (일반·서비스·제휴·쿠폰 …) */
  discounts: Array<{ name: string; amount: number }>;
  /** 엑셀 파일 이름 — 어느 파일에서 왔는지 */
  fileName?: string;
  /** 올린 때 (ISO) */
  uploadedAt?: string;
  /** 올린 사람 이름 */
  uploadedBy?: string;
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

/* ── 체크리스트 (오픈·마감) ───────────────────────────────── */

export type ChecklistSection = "open" | "close";

/** 사장님이 정해 두는 항목 하나 */
export interface ChecklistTemplateItem {
  id: string;
  section: ChecklistSection;
  text: string;
  /**
   * 어느 요일에 하는가 (월=0 … 일=6). **비면 매일.**
   * 「매주 화요일 기름 교체」처럼 정해진 요일에만 나오게 한다.
   */
  days: number[];
}

/** stores/{id}/meta/checklistTemplate — 사장님만 고친다 */
export interface ChecklistTemplate {
  items: ChecklistTemplateItem[];
  updatedAt?: string;
  updatedBy?: string;
}

/** 하루치 체크 한 칸. 글은 체크할 때 그대로 남긴다 — 나중에 항목을 고쳐도 그날 기록은 그대로다. */
export interface ChecklistCheck {
  checked: boolean;
  text: string;
  section: ChecklistSection;
  by?: string;
  at?: string;
}

/** stores/{id}/checklistDays/{YYYY-MM-DD} */
export interface ChecklistDay {
  date: string;
  /** 항목 id → 체크. 칸마다 따로 쓴다(필드 경로) — 둘이 동시에 눌러도 서로 안 덮는다 */
  checks: Record<string, ChecklistCheck>;
  /** 특이사항 */
  note: string;
  noteBy?: string;
  noteAt?: string;
  /** 마지막으로 나챗방에 보낸 기록 (서버가 쓴다) */
  sent?: { at: string; by: string; delivered: number; failed: number } | null;
}

/** 나챗방(카카오톡 「나와의 채팅」) 받는 곳 하나. 토큰은 서버 전용 컬렉션에 따로 있다. */
export interface KakaoMemoLink {
  id: string;
  /** 사장님이 붙인 이름 — 「사장님」, 「실장님」 */
  label: string;
  /** 카카오 닉네임 (동의했을 때만) */
  nickname?: string | null;
  linkedAt: string;
  linkedBy?: string;
  active: boolean;
  /** 마지막으로 못 보낸 이유 — 연결 만료 등 */
  lastError?: string | null;
  lastSentAt?: string | null;
}

export const RESV_STATUSES: ResvStatus[] = [
  "예약확정", "방문완료", "취소", "노쇼", "단체", "확인전화필요", "예약대기",
];

export const SEATS: Seat[] = ["홀A", "홀B", "홀C", "룸1", "룸2", "창가", "단체석"];
