import {
  createContext, useContext, useMemo, useState, useCallback, ReactNode,
} from "react";
import {
  Role, Reservation, Shift, WorkRecord, PayrollRow, Notice,
  INITIAL_RESERVATIONS, INITIAL_SHIFTS, INITIAL_RECORDS,
  INITIAL_PAYROLL, INITIAL_NOTICES, INITIAL_HANDOVERS,
} from "./data";

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
  punchedIn: boolean;
  punchedOut: boolean;
  punchIn: () => void;
  punchOut: () => void;
  toast: string | null;
  showToast: (msg: string) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>("staff");
  const [reservations, setReservations] = useState(INITIAL_RESERVATIONS);
  const [shifts, setShifts] = useState(INITIAL_SHIFTS);
  const [records, setRecords] = useState(INITIAL_RECORDS);
  const [payroll, setPayroll] = useState(INITIAL_PAYROLL);
  const [notices] = useState(INITIAL_NOTICES);
  const [handovers, setHandovers] = useState(INITIAL_HANDOVERS);
  const [punchedIn, setPunchedIn] = useState(false);
  const [punchedOut, setPunchedOut] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  const upsertReservation = useCallback((r: Reservation) => {
    setReservations((prev) => {
      const i = prev.findIndex((x) => x.id === r.id);
      if (i === -1) return [...prev, r].sort((a, b) => a.time.localeCompare(b.time));
      const next = [...prev];
      next[i] = r;
      return next;
    });
  }, []);

  const setShift = useCallback((s: Shift) => {
    setShifts((prev) => {
      const i = prev.findIndex((x) => x.empId === s.empId && x.day === s.day);
      if (i === -1) return [...prev, s];
      const next = [...prev];
      next[i] = s;
      return next;
    });
  }, []);

  const addRecord = useCallback((r: WorkRecord) => {
    setRecords((prev) => [...prev, r]);
  }, []);

  const approveRecord = useCallback((id: number) => {
    setRecords((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: "승인완료" } : r))
    );
  }, []);

  const updatePayroll = useCallback((empId: number, patch: Partial<PayrollRow>) => {
    setPayroll((prev) =>
      prev.map((p) => (p.empId === empId ? { ...p, ...patch } : p))
    );
  }, []);

  const addHandover = useCallback((text: string) => {
    setHandovers((prev) => [
      { id: Date.now(), text, date: "06-12" },
      ...prev,
    ]);
  }, []);

  const value = useMemo<Store>(
    () => ({
      role, setRole,
      reservations, upsertReservation,
      shifts, setShift,
      records, addRecord, approveRecord,
      payroll, updatePayroll,
      notices, handovers, addHandover,
      punchedIn, punchedOut,
      punchIn: () => { setPunchedIn(true); showToast("출근 처리되었습니다 (10:02)"); },
      punchOut: () => { setPunchedOut(true); showToast("퇴근 처리되었습니다"); },
      toast, showToast,
    }),
    [role, reservations, shifts, records, payroll, notices, handovers,
     punchedIn, punchedOut, toast, upsertReservation, setShift, addRecord,
     approveRecord, updatePayroll, addHandover, showToast]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider missing");
  return s;
}
