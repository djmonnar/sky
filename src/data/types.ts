/* 도메인 타입 정의 */

export type Role = "staff" | "admin";
export type EmploymentType = "fullTime" | "partTime";
export type SalaryType = "monthly" | "hourly";

export type ResvStatus =
  | "예약확정"
  | "방문완료"
  | "취소"
  | "노쇼"
  | "단체"
  | "확인전화필요"
  | "예약대기";

export type Seat = "홀A" | "홀B" | "홀C" | "룸1" | "룸2" | "창가" | "단체석";

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
  employmentType: EmploymentType;
  salaryType: SalaryType;
  hourly: number; // 시급
  monthlySalary?: number;
  standardStart?: string;
  standardEnd?: string;
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
  checklist?: boolean[];
  status: "미작성" | "제출" | "승인대기" | "승인완료";
}

export interface PayrollRow {
  empId: number;
  month?: string; // YYYY-MM
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

export const RESV_STATUSES: ResvStatus[] = [
  "예약확정", "방문완료", "취소", "노쇼", "단체", "확인전화필요", "예약대기",
];

export const SEATS: Seat[] = ["홀A", "홀B", "홀C", "룸1", "룸2", "창가", "단체석"];
