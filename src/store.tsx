import {
  createContext, useContext, useMemo, useState, useCallback,
  useEffect, useRef, ReactNode,
} from "react";
import {
  Role, PunchStatus, Reservation, Shift, WorkRecord, PayrollRow,
  Notice, Employee,
} from "./data/types";
import { EMPLOYEES, CURRENT_STAFF_ID } from "./data/mock";
import { TODAY_STR } from "./lib/time";
import { repository } from "./data/repository";
import { firebaseConfigured, STORE_ID } from "./lib/firebase";
import {
  subscribeAuth, fetchUserProfile, signInEmail, signUpEmail,
  createUserProfile, signOutUser,
  type AuthUser,
} from "./services/auth";
import type { UserProfile } from "./types/firestore";
import {
  subscribeEmployees, subscribeReservations, subscribeShifts,
  subscribeRecords, subscribePayroll, subscribeNotices, subscribeHandovers,
  fsUpsertReservation, fsSetShift, fsAddRecord, fsApproveRecord,
  fsUpdatePayroll, fsAddHandover, fsAddAttendanceLog,
} from "./services/firestore";

export type AppMode = "demo" | "live";

/** Firebase 미설정이거나 VITE_DEMO_MODE=true면 데모 모드 (목업 데이터) */
export const APP_MODE: AppMode =
  !firebaseConfigured || import.meta.env.VITE_DEMO_MODE === "true"
    ? "demo"
    : "live";

interface Store {
  mode: AppMode;
  /** 데모 모드 사유 안내 (배너용). live면 null */
  demoReason: string | null;

  role: Role;
  setRole: (r: Role) => void; // live 모드에서는 무시됨

  // 인증 (live 모드)
  authUser: AuthUser | null;
  profile: UserProfile | null;
  authLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string, employeeId: number) => Promise<void>;
  logout: () => Promise<void>;

  loading: boolean;
  error: string | null;

  employees: Employee[];
  /** 로그인된(또는 데모) 실무자 본인 */
  currentEmployee: Employee | null;

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
  const [role, setRoleState] = useState<Role>("staff");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(APP_MODE === "live");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [employees, setEmployees] = useState<Employee[]>([]);
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
  // 회원가입 중에는 auth 리스너가 프로필을 먼저 조회하지 않도록 막음
  // (계정 생성 → users 문서 생성 사이의 레이스 방지)
  const signupInProgress = useRef(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  }, []);

  /* ---------- 데모 모드: 목업 저장소에서 1회 로드 ---------- */
  useEffect(() => {
    if (APP_MODE !== "demo") return;
    (async () => {
      const [resv, sh, rec, pay, not, hand] = await Promise.all([
        repository.listReservations(),
        repository.listShifts(),
        repository.listRecords(),
        repository.listPayroll(),
        repository.listNotices(),
        repository.listHandovers(),
      ]);
      setEmployees(EMPLOYEES);
      setReservations(resv);
      setShifts(sh);
      setRecords(rec);
      setPayroll(pay);
      setNotices(not);
      setHandovers(hand);
      setLoading(false);
    })();
  }, []);

  /* ---------- 라이브 모드: 인증 구독 ---------- */
  useEffect(() => {
    if (APP_MODE !== "live") return;
    return subscribeAuth(async (u) => {
      if (!u) {
        setAuthUser(null);
        setProfile(null);
        setAuthLoading(false);
        setLoading(true);
        return;
      }
      if (signupInProgress.current) {
        // 프로필은 signup()이 직접 생성·설정함
        setAuthLoading(false);
        return;
      }
      setAuthUser({ uid: u.uid, email: u.email });
      try {
        const p = await fetchUserProfile(u.uid);
        if (!p) {
          setError(
            `users/${u.uid} 문서가 없습니다. Firebase 콘솔에서 사용자 프로필(role, storeId, employeeId)을 등록해주세요.`
          );
        } else if (!p.active) {
          setError("비활성화된 계정입니다. 관리자에게 문의해주세요.");
        } else {
          setError(null);
          setProfile(p);
          setRoleState(p.role);
        }
      } catch (e) {
        setError(`사용자 프로필을 불러오지 못했습니다: ${(e as Error).message}`);
      }
      setAuthLoading(false);
    });
  }, []);

  /* ---------- 라이브 모드: Firestore 실시간 구독 ---------- */
  useEffect(() => {
    if (APP_MODE !== "live" || !profile) return;
    setLoading(true);

    const onErr = (e: Error) => {
      console.error("[firestore]", e);
      setError(`데이터를 불러오지 못했습니다: ${e.message}`);
      setLoading(false);
    };

    // staff는 본인 근무표/근무기록만, admin은 전체 (Security Rules와 일치)
    const empFilter =
      profile.role === "staff" ? profile.employeeId : undefined;

    let gotFirst = false;
    const markLoaded = () => {
      if (!gotFirst) {
        gotFirst = true;
        setLoading(false);
      }
    };

    const unsubs = [
      subscribeEmployees((v) => { setEmployees(v); markLoaded(); }, onErr),
      subscribeReservations(setReservations, onErr),
      subscribeShifts(empFilter, setShifts, onErr),
      subscribeRecords(empFilter, setRecords, onErr),
      subscribeNotices(setNotices, onErr),
      subscribeHandovers(setHandovers, onErr),
      // 급여는 관리자만 구독 (staff는 Rules상 본인 문서만 허용, 화면도 없음)
      ...(profile.role === "admin"
        ? [subscribePayroll(setPayroll, onErr)]
        : []),
    ];
    return () => unsubs.forEach((u) => u());
  }, [profile]);

  const currentEmployee = useMemo<Employee | null>(() => {
    const targetId =
      APP_MODE === "demo" ? CURRENT_STAFF_ID : profile?.employeeId;
    return employees.find((e) => e.id === targetId) ?? null;
  }, [employees, profile]);

  /* ---------- 쓰기 (live: Firestore / demo: 목업 저장소+로컬) ---------- */

  const fail = useCallback(
    (what: string) => (e: unknown) => {
      console.error(e);
      showToast(`${what} 실패: 권한 또는 네트워크를 확인해주세요`);
    },
    [showToast]
  );

  const upsertReservation = useCallback((r: Reservation) => {
    if (APP_MODE === "live") {
      fsUpsertReservation(r).catch(fail("예약 저장"));
      return; // 화면 갱신은 onSnapshot이 처리 (로컬 쓰기 즉시 반영됨)
    }
    void repository.saveReservation(r);
    setReservations((prev) => {
      const i = prev.findIndex((x) => x.id === r.id);
      if (i === -1) return [...prev, r].sort((a, b) => a.time.localeCompare(b.time));
      const next = [...prev];
      next[i] = r;
      return next;
    });
  }, [fail]);

  const setShift = useCallback((s: Shift) => {
    if (APP_MODE === "live") {
      fsSetShift(s).catch(fail("근무표 저장"));
      return;
    }
    void repository.saveShift(s);
    setShifts((prev) => {
      const i = prev.findIndex((x) => x.empId === s.empId && x.day === s.day);
      if (i === -1) return [...prev, s];
      const next = [...prev];
      next[i] = s;
      return next;
    });
  }, [fail]);

  const addRecord = useCallback((r: WorkRecord) => {
    if (APP_MODE === "live") {
      fsAddRecord(r).catch(fail("근무기록 저장"));
      return;
    }
    void repository.addRecord(r);
    setRecords((prev) => [...prev, r]);
  }, [fail]);

  const approveRecord = useCallback((id: number) => {
    if (APP_MODE === "live") {
      fsApproveRecord(id).catch(fail("근무기록 승인"));
      return;
    }
    void repository.updateRecord(id, { status: "승인완료" });
    setRecords((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: "승인완료" } : r))
    );
  }, [fail]);

  const updatePayroll = useCallback((empId: number, patch: Partial<PayrollRow>) => {
    if (APP_MODE === "live") {
      fsUpdatePayroll(empId, patch).catch(fail("급여 수정"));
      return;
    }
    void repository.updatePayroll(empId, patch);
    setPayroll((prev) =>
      prev.map((p) => (p.empId === empId ? { ...p, ...patch } : p))
    );
  }, [fail]);

  const addHandover = useCallback((text: string) => {
    const n: Notice = { id: Date.now(), text, date: TODAY_STR.slice(5) };
    if (APP_MODE === "live") {
      fsAddHandover(n, profile?.name ?? "unknown").catch(fail("전달사항 등록"));
      return;
    }
    void repository.addHandover(n);
    setHandovers((prev) => [n, ...prev]);
  }, [fail, profile]);

  const punchIn = useCallback(() => {
    const t = nowHHMM();
    setPunchStatus("working");
    setPunchInAt(t);
    if (APP_MODE === "live" && currentEmployee) {
      fsAddAttendanceLog({
        empId: currentEmployee.id, date: TODAY_STR, type: "in", time: t,
      }).catch(fail("출근 기록"));
    }
    showToast(`출근 처리되었습니다 (${t})`);
  }, [showToast, fail, currentEmployee]);

  const punchOut = useCallback(() => {
    const t = nowHHMM();
    setPunchStatus("done");
    setPunchOutAt(t);
    if (APP_MODE === "live" && currentEmployee) {
      fsAddAttendanceLog({
        empId: currentEmployee.id, date: TODAY_STR, type: "out", time: t,
      }).catch(fail("퇴근 기록"));
    }
    showToast(`퇴근 처리되었습니다 (${t})`);
  }, [showToast, fail, currentEmployee]);

  const setRole = useCallback((r: Role) => {
    if (APP_MODE === "live") return; // 운영 모드에서는 users/{uid}.role이 기준
    setRoleState(r);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    await signInEmail(email, password);
  }, []);

  const signup = useCallback(
    async (name: string, email: string, password: string, employeeId: number) => {
      signupInProgress.current = true;
      try {
        const { uid, email: createdEmail } = await signUpEmail(email, password);
        const newProfile: UserProfile = {
          name,
          role: "staff", // 회원가입은 무조건 실무자 — 관리자 승격은 콘솔/관리자 화면에서
          storeId: STORE_ID,
          employeeId,
          active: true,
        };
        await createUserProfile(uid, newProfile);
        setProfile(newProfile);
        setRoleState("staff");
        setError(null);
        setAuthUser({ uid, email: createdEmail });
        showToast("회원가입이 완료되었습니다.");
      } finally {
        signupInProgress.current = false;
      }
    },
    [showToast]
  );

  const logout = useCallback(async () => {
    await signOutUser();
    setProfile(null);
    setAuthUser(null);
    setRoleState("staff");
  }, []);

  const demoReason =
    APP_MODE === "demo"
      ? firebaseConfigured
        ? "데모 모드 (VITE_DEMO_MODE=true) — 목업 데이터로 동작 중"
        : "Firebase 미설정 — 목업 데이터로 동작 중 (.env 설정 시 실데이터 연결)"
      : null;

  const value = useMemo<Store>(
    () => ({
      mode: APP_MODE, demoReason,
      role, setRole,
      authUser, profile, authLoading, login, signup, logout,
      loading, error,
      employees, currentEmployee,
      reservations, upsertReservation,
      shifts, setShift,
      records, addRecord, approveRecord,
      payroll, updatePayroll,
      notices, handovers, addHandover,
      punchStatus, punchInAt, punchOutAt, punchIn, punchOut,
      toast, showToast,
    }),
    [demoReason, role, setRole, authUser, profile, authLoading, login, signup, logout,
     loading, error, employees, currentEmployee,
     reservations, shifts, records, payroll, notices, handovers,
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
