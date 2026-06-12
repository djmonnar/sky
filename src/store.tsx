import {
  createContext, useContext, useMemo, useState, useCallback,
  useEffect, ReactNode,
} from "react";
import {
  Role, PunchStatus, Reservation, Shift, WorkRecord, PayrollRow, Notice,
} from "./data/types";
import { repository } from "./data/repository";

interface Store {
  role: Role;
  setRole: (r: Role) => void;

  reservations: Reservation[];
  upsertReservation: (r: Reservation) => void;

  shifts: Shift[];
  setShift: (s: Shift) => void;

  records: WorkRecord[];
  addRecord: (r: WorkRecord) => void;
  approveRecord: (id: number) => void;

  payroll: PayrollRow[];
  updatePayroll: (empId: number, patch: Partial<PayrollRow>) => void;

  notices: Notice[];
  handovers: Notice[];
  addHandover: (text: string) => void;

  punchStatus: PunchStatus;
  punchInAt: string | null;
  punchOutAt: string | null;
  punchIn: () => void;
  punchOut: () => void;

  toast: string | null;
  showToast: (msg: string) => void;
}

const Ctx = createContext<Store | null>(null);

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>("staff");
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [records, setRecords] = useState<WorkRecord[]>([]);
  const [payroll, setPayroll] = useState<PayrollRow[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [handovers, setHandovers] = useState<Notice[]>([]);
  const [punchStatus, setPunchStatus] = useState<PunchStatus>("before");
  const [punchInAt, setPunchInAt] = useState<string | null>(null);
  const [punchOutAt, setPunchOutAt] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 저장소에서 초기 데이터 로드 (Firebase 전환 시에도 동일 흐름)
  useEffect(() => {
    (async () => {
      const [resv, sh, rec, pay, not, hand] = await Promise.all([
        repository.listReservations(),
        repository.listShifts(),
        repository.listRecords(),
        repository.listPayroll(),
        repository.listNotices(),
        repository.listHandovers(),
      ]);
      setReservations(resv);
      setShifts(sh);
      setRecords(rec);
      setPayroll(pay);
      setNotices(not);
      setHandovers(hand);
    })();
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  const upsertReservation = useCallback((r: Reservation) => {
    void repository.saveReservation(r);
    setReservations((prev) => {
      const i = prev.findIndex((x) => x.id === r.id);
      if (i === -1) return [...prev, r].sort((a, b) => a.time.localeCompare(b.time));
      const next = [...prev];
      next[i] = r;
      return next;
    });
  }, []);

  const setShift = useCallback((s: Shift) => {
    void repository.saveShift(s);
    setShifts((prev) => {
      const i = prev.findIndex((x) => x.empId === s.empId && x.day === s.day);
      if (i === -1) return [...prev, s];
      const next = [...prev];
      next[i] = s;
      return next;
    });
  }, []);

  const addRecord = useCallback((r: WorkRecord) => {
    void repository.addRecord(r);
    setRecords((prev) => [...prev, r]);
  }, []);

  const approveRecord = useCallback((id: number) => {
    void repository.updateRecord(id, { status: "승인완료" });
    setRecords((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: "승인완료" } : r))
    );
  }, []);

  const updatePayroll = useCallback((empId: number, patch: Partial<PayrollRow>) => {
    void repository.updatePayroll(empId, patch);
    setPayroll((prev) =>
      prev.map((p) => (p.empId === empId ? { ...p, ...patch } : p))
    );
  }, []);

  const addHandover = useCallback((text: string) => {
    const n: Notice = { id: Date.now(), text, date: "06-12" };
    void repository.addHandover(n);
    setHandovers((prev) => [n, ...prev]);
  }, []);

  const punchIn = useCallback(() => {
    const t = nowHHMM();
    setPunchStatus("working");
    setPunchInAt(t);
    showToast(`출근 처리되었습니다 (${t})`);
  }, [showToast]);

  const punchOut = useCallback(() => {
    const t = nowHHMM();
    setPunchStatus("done");
    setPunchOutAt(t);
    showToast(`퇴근 처리되었습니다 (${t})`);
  }, [showToast]);

  const value = useMemo<Store>(
    () => ({
      role, setRole,
      reservations, upsertReservation,
      shifts, setShift,
      records, addRecord, approveRecord,
      payroll, updatePayroll,
      notices, handovers, addHandover,
      punchStatus, punchInAt, punchOutAt, punchIn, punchOut,
      toast, showToast,
    }),
    [role, reservations, shifts, records, payroll, notices, handovers,
     punchStatus, punchInAt, punchOutAt, toast,
     upsertReservation, setShift, addRecord, approveRecord, updatePayroll,
     addHandover, punchIn, punchOut, showToast]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider missing");
  return s;
}
