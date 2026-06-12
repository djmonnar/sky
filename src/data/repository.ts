/* ============================================================
   데이터 저장소 추상화 (data layer)

   UI/스토어는 이 Repository 인터페이스만 사용합니다.
   Firebase/Supabase로 전환할 때는 createMockRepository()를
   같은 인터페이스를 구현한 createFirebaseRepository() 등으로
   교체하면 되고, 화면 코드는 수정할 필요가 없습니다.
   ============================================================ */

import {
  Reservation, Shift, WorkRecord, PayrollRow, Notice,
} from "./types";
import {
  SEED_RESERVATIONS, SEED_SHIFTS, SEED_RECORDS,
  SEED_PAYROLL, SEED_NOTICES, SEED_HANDOVERS,
} from "./mock";

export interface Repository {
  listReservations(): Promise<Reservation[]>;
  saveReservation(r: Reservation): Promise<void>;

  listShifts(): Promise<Shift[]>;
  saveShift(s: Shift): Promise<void>;
  deleteShift(id: string): Promise<void>;

  listRecords(): Promise<WorkRecord[]>;
  addRecord(r: WorkRecord): Promise<void>;
  updateRecord(id: number, patch: Partial<WorkRecord>): Promise<void>;

  listPayroll(): Promise<PayrollRow[]>;
  updatePayroll(empId: number, patch: Partial<PayrollRow>): Promise<void>;

  listNotices(): Promise<Notice[]>;
  listHandovers(): Promise<Notice[]>;
  addHandover(n: Notice): Promise<void>;
}

/** 인메모리 목업 구현 — 새로고침 시 초기화됨 */
export function createMockRepository(): Repository {
  const db = {
    reservations: structuredClone(SEED_RESERVATIONS),
    shifts: structuredClone(SEED_SHIFTS),
    records: structuredClone(SEED_RECORDS),
    payroll: structuredClone(SEED_PAYROLL),
    notices: structuredClone(SEED_NOTICES),
    handovers: structuredClone(SEED_HANDOVERS),
  };

  return {
    async listReservations() { return [...db.reservations]; },
    async saveReservation(r) {
      const i = db.reservations.findIndex((x) => x.id === r.id);
      if (i === -1) db.reservations.push(r);
      else db.reservations[i] = r;
    },

    async listShifts() { return [...db.shifts]; },
    async saveShift(s) {
      const i = db.shifts.findIndex((x) => x.id === s.id);
      if (i === -1) db.shifts.push(s);
      else db.shifts[i] = s;
    },
    async deleteShift(id) {
      const i = db.shifts.findIndex((x) => x.id === id);
      if (i !== -1) db.shifts.splice(i, 1);
    },

    async listRecords() { return [...db.records]; },
    async addRecord(r) { db.records.push(r); },
    async updateRecord(id, patch) {
      const i = db.records.findIndex((x) => x.id === id);
      if (i !== -1) db.records[i] = { ...db.records[i], ...patch };
    },

    async listPayroll() { return [...db.payroll]; },
    async updatePayroll(empId, patch) {
      const i = db.payroll.findIndex((x) => x.empId === empId);
      if (i !== -1) db.payroll[i] = { ...db.payroll[i], ...patch };
    },

    async listNotices() { return [...db.notices]; },
    async listHandovers() { return [...db.handovers]; },
    async addHandover(n) { db.handovers.unshift(n); },
  };
}

/** 앱 전역에서 사용하는 저장소 인스턴스 (전환 지점) */
export const repository: Repository = createMockRepository();
