/* 하늘땅 매장관리 — 타입 및 목업 데이터 */

export type Role = "staff" | "admin";

export type ResvStatus =
  | "예약확정"
  | "방문완료"
  | "취소"
  | "노쇼"
  | "단체"
  | "확인전화필요"
  | "예약대기";

export type Seat = "홀A" | "홀B" | "홀C" | "룸1" | "룸2" | "창가" | "단체석";

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
  hourly: number; // 시급
  color?: string;
}

export interface Shift {
  empId: number;
  day: number; // 0=월 ... 6=일
  start?: string;
  end?: string;
  breakMin: number;
  off?: boolean;
}

export interface WorkRecord {
  id: number;
  empId: number;
  date: string;
  planStart: string;
  planEnd: string;
  actualStart?: string;
  actualEnd?: string;
  breakMin: number;
  note?: string;
  handover?: string;
  status: "미작성" | "제출" | "승인대기" | "승인완료";
}

export interface PayrollRow {
  empId: number;
  hours: number;
  base: number;
  extra: number;
  deduct: number;
  status: "승인대기" | "검토중" | "승인완료";
  normalH: number;
  overH: number;
  holidayH: number;
  nightH: number;
  editedRecords: number;
}

export interface Notice {
  id: number;
  text: string;
  date: string;
  pinned?: boolean;
}

/* ---------- 날짜 유틸 ---------- */
export const TODAY = new Date("2026-06-12T10:30:00"); // 데모 기준일 (금요일)
export const DOW_KO = ["월", "화", "수", "목", "금", "토", "일"];

export function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
export function dowIndex(d: Date): number {
  return (d.getDay() + 6) % 7; // 월=0
}
export function weekDates(base: Date): Date[] {
  const start = new Date(base);
  start.setDate(start.getDate() - dowIndex(base));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}
export const TODAY_STR = fmtDate(TODAY);
export const TODAY_DOW = dowIndex(TODAY);

export function minutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
export function toTime(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
export function durationH(start: string, end: string, breakMin: number): number {
  return Math.max(0, (minutes(end) - minutes(start) - breakMin) / 60);
}
export function won(n: number): string {
  return n.toLocaleString("ko-KR") + "원";
}

/* ---------- 직원 ---------- */
export const EMPLOYEES: Employee[] = [
  { id: 1, name: "김민수", role: "홀", hourly: 10500 },
  { id: 2, name: "이영희", role: "주방", hourly: 11500 },
  { id: 3, name: "박지훈", role: "홀", hourly: 10500 },
  { id: 4, name: "최수연", role: "홀", hourly: 10030 },
  { id: 5, name: "김도현", role: "주방", hourly: 11000 },
  { id: 6, name: "정하늘", role: "매니저", hourly: 13000 },
];

export const CURRENT_STAFF_ID = 1; // 로그인된 실무자: 김민수

/* ---------- 예약 ---------- */
export const SEATS: Seat[] = ["홀A", "홀B", "홀C", "룸1", "룸2", "창가", "단체석"];
export const RESV_STATUSES: ResvStatus[] = [
  "예약확정", "방문완료", "취소", "노쇼", "단체", "확인전화필요", "예약대기",
];

export const INITIAL_RESERVATIONS: Reservation[] = [
  { id: 1, date: TODAY_STR, time: "11:30", name: "박지훈", phone: "010-1234-5678", people: 4, seat: "룸1", status: "예약확정", request: "창가 자리 선호", writer: "정하늘", createdAt: "2026-06-10 14:25" },
  { id: 2, date: TODAY_STR, time: "12:00", name: "최수민", phone: "010-2345-6789", people: 12, seat: "단체석", status: "단체", request: "단체 회식, 미리 상차림 요청", writer: "정하늘", createdAt: "2026-06-09 11:02", memo: "선결제 완료" },
  { id: 3, date: TODAY_STR, time: "12:30", name: "김도현", phone: "010-2468-1357", people: 2, seat: "창가", status: "방문완료", request: "성인 2, 아동 0", writer: "김민수", createdAt: "2026-06-10 14:25" },
  { id: 4, date: TODAY_STR, time: "13:00", name: "이서윤", phone: "010-3456-7890", people: 3, seat: "홀A", status: "확인전화필요", request: "유아의자 1개", writer: "정하늘", createdAt: "2026-06-11 09:40" },
  { id: 5, date: TODAY_STR, time: "17:30", name: "강민재", phone: "010-4567-8901", people: 5, seat: "홀B", status: "예약확정", writer: "김민수", createdAt: "2026-06-11 18:12" },
  { id: 6, date: TODAY_STR, time: "18:00", name: "윤지아", phone: "010-5678-9012", people: 8, seat: "룸2", status: "단체", request: "생일 모임, 케이크 반입", writer: "정하늘", createdAt: "2026-06-08 16:33" },
  { id: 7, date: TODAY_STR, time: "18:30", name: "한상우", phone: "010-6789-0123", people: 2, seat: "홀C", status: "예약대기", writer: "최수연", createdAt: "2026-06-12 09:05" },
  { id: 8, date: TODAY_STR, time: "19:00", name: "오세린", phone: "010-7890-1234", people: 4, seat: "홀A", status: "예약확정", request: "주차 안내 필요", writer: "정하늘", createdAt: "2026-06-11 13:20" },
  { id: 9, date: TODAY_STR, time: "19:30", name: "임준호", phone: "010-8901-2345", people: 2, seat: "창가", status: "취소", memo: "개인 사정으로 취소", writer: "김민수", createdAt: "2026-06-10 10:15" },
  { id: 10, date: TODAY_STR, time: "20:00", name: "송예진", phone: "010-9012-3456", people: 6, seat: "룸1", status: "확인전화필요", request: "룸 희망, 인원 변동 가능", writer: "정하늘", createdAt: "2026-06-11 20:48" },
  { id: 11, date: TODAY_STR, time: "20:30", name: "백승호", phone: "010-1357-2468", people: 3, seat: "홀B", status: "노쇼", writer: "최수연", createdAt: "2026-06-07 12:00" },
  { id: 12, date: TODAY_STR, time: "21:00", name: "조은별", phone: "010-2469-1358", people: 2, seat: "홀C", status: "예약확정", writer: "김민수", createdAt: "2026-06-12 08:30" },
];

/* ---------- 주간 근무표 ---------- */
// day: 0=월 ~ 6=일
export const INITIAL_SHIFTS: Shift[] = [
  // 김민수
  { empId: 1, day: 0, start: "10:00", end: "15:00", breakMin: 30 },
  { empId: 1, day: 1, start: "17:00", end: "22:00", breakMin: 30 },
  { empId: 1, day: 2, start: "10:00", end: "15:00", breakMin: 30 },
  { empId: 1, day: 3, off: true, breakMin: 0 },
  { empId: 1, day: 4, start: "10:00", end: "15:00", breakMin: 30 },
  { empId: 1, day: 5, start: "11:00", end: "16:00", breakMin: 30 },
  { empId: 1, day: 6, off: true, breakMin: 0 },
  // 이영희
  { empId: 2, day: 0, start: "09:00", end: "15:00", breakMin: 60 },
  { empId: 2, day: 1, start: "09:00", end: "15:00", breakMin: 60 },
  { empId: 2, day: 2, off: true, breakMin: 0 },
  { empId: 2, day: 3, start: "09:00", end: "15:00", breakMin: 60 },
  { empId: 2, day: 4, start: "09:00", end: "15:00", breakMin: 60 },
  { empId: 2, day: 5, start: "09:00", end: "14:00", breakMin: 30 },
  { empId: 2, day: 6, start: "09:00", end: "14:00", breakMin: 30 },
  // 박지훈
  { empId: 3, day: 0, start: "17:00", end: "22:00", breakMin: 30 },
  { empId: 3, day: 1, start: "17:00", end: "22:00", breakMin: 30 },
  { empId: 3, day: 2, start: "17:00", end: "22:00", breakMin: 30 },
  { empId: 3, day: 3, start: "17:00", end: "22:00", breakMin: 30 },
  { empId: 3, day: 4, off: true, breakMin: 0 },
  { empId: 3, day: 5, start: "12:00", end: "21:00", breakMin: 60 },
  { empId: 3, day: 6, start: "12:00", end: "21:00", breakMin: 60 },
  // 최수연
  { empId: 4, day: 0, off: true, breakMin: 0 },
  { empId: 4, day: 1, start: "10:00", end: "15:00", breakMin: 30 },
  { empId: 4, day: 2, start: "10:00", end: "15:00", breakMin: 30 },
  { empId: 4, day: 3, start: "10:00", end: "15:00", breakMin: 30 },
  { empId: 4, day: 4, start: "17:00", end: "22:00", breakMin: 30 },
  { empId: 4, day: 5, off: true, breakMin: 0 },
  { empId: 4, day: 6, start: "11:00", end: "16:00", breakMin: 30 },
  // 김도현
  { empId: 5, day: 0, start: "15:00", end: "22:00", breakMin: 60 },
  { empId: 5, day: 1, start: "15:00", end: "22:00", breakMin: 60 },
  { empId: 5, day: 2, start: "15:00", end: "22:00", breakMin: 60 },
  { empId: 5, day: 3, off: true, breakMin: 0 },
  { empId: 5, day: 4, start: "15:00", end: "22:00", breakMin: 60 },
  { empId: 5, day: 5, start: "15:00", end: "22:00", breakMin: 60 },
  { empId: 5, day: 6, start: "15:00", end: "22:00", breakMin: 60 },
  // 정하늘
  { empId: 6, day: 0, start: "09:30", end: "18:00", breakMin: 60 },
  { empId: 6, day: 1, start: "09:30", end: "18:00", breakMin: 60 },
  { empId: 6, day: 2, start: "09:30", end: "18:00", breakMin: 60 },
  { empId: 6, day: 3, start: "09:30", end: "18:00", breakMin: 60 },
  { empId: 6, day: 4, start: "09:30", end: "18:00", breakMin: 60 },
  { empId: 6, day: 5, off: true, breakMin: 0 },
  { empId: 6, day: 6, off: true, breakMin: 0 },
];

/* ---------- 근무기록 ---------- */
export const INITIAL_RECORDS: WorkRecord[] = [
  { id: 1, empId: 1, date: "2026-06-08", planStart: "10:00", planEnd: "15:00", actualStart: "10:00", actualEnd: "15:00", breakMin: 30, status: "승인완료" },
  { id: 2, empId: 1, date: "2026-06-09", planStart: "17:00", planEnd: "22:00", actualStart: "17:00", actualEnd: "22:15", breakMin: 30, status: "승인완료", note: "마감 정리 15분 연장" },
  { id: 3, empId: 1, date: "2026-06-10", planStart: "10:00", planEnd: "15:00", actualStart: "10:10", actualEnd: "15:00", breakMin: 30, status: "승인대기", note: "버스 지연으로 10분 늦음" },
  { id: 4, empId: 3, date: "2026-06-11", planStart: "17:00", planEnd: "22:00", actualStart: "17:00", actualEnd: "22:30", breakMin: 30, status: "승인대기", note: "단체손님 마감 지연" },
  { id: 5, empId: 4, date: "2026-06-11", planStart: "10:00", planEnd: "15:00", actualStart: "10:00", actualEnd: "15:00", breakMin: 30, status: "승인대기" },
  { id: 6, empId: 5, date: "2026-06-11", planStart: "15:00", planEnd: "22:00", actualStart: "15:00", actualEnd: "22:00", breakMin: 60, status: "제출" },
  { id: 7, empId: 2, date: "2026-06-11", planStart: "09:00", planEnd: "15:00", actualStart: "08:50", actualEnd: "15:00", breakMin: 60, status: "승인대기", note: "재료 입고 검수로 일찍 출근" },
];

/* ---------- 급여 ---------- */
export const INITIAL_PAYROLL: PayrollRow[] = [
  { empId: 1, hours: 86.5, base: 908250, extra: 45000, deduct: 0, status: "승인대기", normalH: 80, overH: 4.5, holidayH: 2, nightH: 0, editedRecords: 1 },
  { empId: 2, hours: 102, base: 1173000, extra: 80000, deduct: 0, status: "검토중", normalH: 92, overH: 6, holidayH: 4, nightH: 0, editedRecords: 0 },
  { empId: 3, hours: 96.5, base: 1013250, extra: 62000, deduct: 15000, status: "승인대기", normalH: 84, overH: 8.5, holidayH: 4, nightH: 6, editedRecords: 2 },
  { empId: 4, hours: 78, base: 782340, extra: 21000, deduct: 0, status: "승인완료", normalH: 76, overH: 2, holidayH: 0, nightH: 0, editedRecords: 0 },
  { empId: 5, hours: 118, base: 1298000, extra: 96000, deduct: 0, status: "검토중", normalH: 104, overH: 8, holidayH: 6, nightH: 12, editedRecords: 1 },
  { empId: 6, hours: 168, base: 2184000, extra: 150000, deduct: 30000, status: "승인완료", normalH: 160, overH: 8, holidayH: 0, nightH: 0, editedRecords: 0 },
];

/* ---------- 공지 / 전달사항 ---------- */
export const INITIAL_NOTICES: Notice[] = [
  { id: 1, text: "6월 셋째 주 위생점검 예정 — 주방/홀 청소 체크리스트 필수 확인", date: "06-11", pinned: true },
  { id: 2, text: "신메뉴 '들깨 칼국수' 6월 15일 출시, 레시피 교육 참석 필수", date: "06-10", pinned: true },
  { id: 3, text: "포스기 영수증 용지 발주 완료 — 수요일 입고 예정", date: "06-09" },
  { id: 4, text: "에어컨 필터 교체 완료, 이상 시 매니저에게 보고", date: "06-08" },
];

export const INITIAL_HANDOVERS: Notice[] = [
  { id: 1, text: "12시 단체 예약 룸 1세팅 먼저 부탁드립니다.", date: "06-12" },
  { id: 2, text: "유아의자 1개 13시 예약 테이블에 미리 준비해주세요.", date: "06-12" },
  { id: 3, text: "창가 쪽 블라인드 수리 접수했습니다. 당분간 수동 조작입니다.", date: "06-11" },
  { id: 4, text: "마감 시 식기세척기 필터 청소 꼭 확인 부탁드립니다.", date: "06-11" },
];

/* ---------- 체크리스트 ---------- */
export const CHECKLIST_TEMPLATE = [
  "오픈 준비 (테이블 세팅, 집기 확인, 메뉴판 점검)",
  "냉장/냉동 온도 기록",
  "예약 테이블 사전 세팅 확인",
  "재료 소진 품목 매니저 보고",
  "마감 청소 (홀 바닥, 주방 정리, 분리수거)",
];
