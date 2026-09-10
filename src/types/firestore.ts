/* Firestore 문서 타입 — 도메인 타입 + 감사(audit) 필드 */

import type {
  AttendanceType,
  Reservation, Employee, Shift, WorkRecord, PayrollRow, Notice, Role,
} from "../data/types";

/** serverTimestamp()는 읽기 시 Timestamp 객체로 돌아오므로 unknown으로 둠 */
export interface AuditFields {
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type ReservationDoc = Reservation & AuditFields;
export type EmployeeDoc = Employee & AuditFields & { active: boolean };
export type ShiftDoc = Shift & AuditFields;
export type WorkRecordDoc = WorkRecord & AuditFields;
export type PayrollDoc = PayrollRow & AuditFields & { month?: string; memo?: string };
export type NoticeDoc = Notice & AuditFields;
export type HandoverDoc = Notice & AuditFields & { createdBy?: string };

/** 출퇴근·휴게 기록. 한 번 쓰면 고치지 못한다 (Rules 에서 update/delete 금지). */
export interface AttendanceLogDoc extends AuditFields {
  empId: number;
  date: string;   // YYYY-MM-DD
  type: AttendanceType;
  time: string;   // HH:mm
}

/** 직원이 월말에 관리자에게 보내는 근무내역. 문서 ID = `${empId}_${YYYY-MM}` */
export interface TimesheetSubmissionDoc extends AuditFields {
  empId: number;
  empName: string;
  month: string;        // YYYY-MM
  status: "제출" | "확인완료";
  workedDays: number;
  totalMinutes: number;
  breakMinutes: number;
  note?: string;
  submittedAt?: unknown;
  reviewedAt?: unknown;
  reviewedBy?: string;
}

/** users/{uid} */
export interface UserProfile {
  name: string;
  role: Role;
  storeId: string;
  employeeId?: number;
  active: boolean;
  phone?: string;
  address?: string;
  residentRegistrationNumber?: string;
  bank?: string;
  account?: string;
}

export type UserProfileDoc = UserProfile & AuditFields & { uid: string };
