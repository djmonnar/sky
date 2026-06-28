/* Firestore 문서 타입 — 도메인 타입 + 감사(audit) 필드 */

import type {
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

export interface AttendanceLogDoc extends AuditFields {
  empId: number;
  date: string;   // YYYY-MM-DD
  type: "in" | "out";
  time: string;   // HH:mm
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
