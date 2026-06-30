import {
  createContext, useContext, useMemo, useState, useCallback,
  useEffect, useRef, ReactNode,
} from "react";
import {
  Role, PunchStatus, Reservation, Shift, WorkRecord, PayrollRow,
  Notice, Employee, Vendor, InventoryCategoryItem, InventoryItem, PurchaseOrder, StockLog, Recipe, SalesOrder, SalesSyncRun,
  OwnerSchedule, ManagerPermissions, ManagerPermissionKey,
} from "./data/types";
import { CURRENT_STAFF_ID } from "./data/mock";
import { TODAY_STR } from "./lib/time";
import { repository } from "./data/repository";
import { firebaseConfigured, STORE_ID } from "./lib/firebase";
import { adminProfileForEmail, isAdminEmail } from "./config/admins";
import {
  subscribeAuth, fetchUserProfile, signInEmail, signUpEmail,
  createUserProfile, createStaffProfile, signOutUser,
  type AuthUser,
} from "./services/auth";
import type { UserProfile, UserProfileDoc } from "./types/firestore";
import {
  subscribeEmployees, subscribeReservations, subscribeShifts,
  subscribeRecords, subscribePayroll, subscribeNotices, subscribeHandovers,
  fsUpsertReservation, fsDeleteReservation,
  fsUpsertEmployee, fsDeleteEmployee, fsDeactivateUserProfile,
  fsSetShift, fsDeleteShift, fsAddRecord, fsApproveRecord,
  fsUpdatePayroll, fsGetPayrollPassword, fsSetPayrollPassword,
  subscribeOwnerSchedules, fsUpsertOwnerSchedule, fsDeleteOwnerSchedule,
  fsUpsertNotice, fsDeleteNotice,
  fsUpsertHandover, fsDeleteHandover, fsAddAttendanceLog,
  subscribeUserProfiles, fsUpdateUserRole,
  subscribeVendors, subscribeRecipes,
  fsUpsertVendor, fsDeleteVendor, fsUpsertRecipe, fsDeleteRecipe,
  subscribeInventoryCategories, subscribeInventoryItems, subscribePurchaseOrders,
  fsUpsertInventoryCategory, fsDeleteInventoryCategory,
  fsUpsertInventoryItem, fsDeleteInventoryItem,
  fsUpsertPurchaseOrder, fsDeletePurchaseOrder, fsReceivePurchaseOrder,
  subscribeSalesOrders, subscribeSalesSyncRuns, fsSyncOkposSales,
  fsUpdateMyProfile,
  subscribeManagerPermissions, fsSetManagerPermissions,
} from "./services/firestore";
import { sortShifts } from "./lib/shifts";
import { DEFAULT_MANAGER_PERMISSIONS, normalizeManagerPermissions } from "./config/managerPermissions";

export type AppMode = "demo" | "live";

/** Firebase 미설정이거나 VITE_DEMO_MODE=true면 데모 모드 (목업 데이터) */
export const APP_MODE: AppMode =
  !firebaseConfigured || import.meta.env.VITE_DEMO_MODE === "true"
    ? "demo"
    : "live";

const DEFAULT_PAYROLL_PASSWORD = "qaz@qwer4312";

function loadDemoManagerPermissions(): ManagerPermissions {
  try {
    const raw = window.localStorage.getItem("haneulttang.managerPermissions");
    return normalizeManagerPermissions(raw ? JSON.parse(raw) as Partial<ManagerPermissions> : null);
  } catch {
    return DEFAULT_MANAGER_PERMISSIONS;
  }
}

interface Store {
  mode: AppMode;
  /** 데모 모드 사유 안내 (배너용). live면 null */
  demoReason: string | null;

  role: Role;
  setRole: (r: Role) => void; // live 모드에서는 무시됨
  managerPermissions: ManagerPermissions;
  updateManagerPermissions: (next: ManagerPermissions) => Promise<void>;
  canManagerAccess: (key: ManagerPermissionKey) => boolean;

  // 인증 (live 모드)
  authUser: AuthUser | null;
  profile: UserProfile | null;
  authLoading: boolean;
  login: (email: string, password: string, rememberLogin?: boolean) => Promise<void>;
  signup: (data: {
    name: string; email: string; password: string; phone: string;
    address: string; residentRegistrationNumber: string; bank: string; account: string;
  }) => Promise<void>;
  /** 로그인됐지만 프로필이 없는 계정의 프로필을 완성 (가입 트랜잭션 실패 복구) */
  completeProfile: (data: {
    name: string; phone: string; address: string; residentRegistrationNumber: string; bank: string; account: string;
  }) => Promise<void>;
  updateMyProfile: (data: {
    name: string; phone: string; address: string; residentRegistrationNumber: string; bank: string; account: string;
  }) => Promise<void>;
  logout: () => Promise<void>;

  loading: boolean;
  error: string | null;

  employees: Employee[];
  upsertEmployee: (employee: Employee) => void;
  deleteEmployee: (id: number) => void;
  deactivateUserProfile: (uid: string) => Promise<void>;
  userProfiles: UserProfileDoc[];
  updateUserRole: (uid: string, role: Role) => Promise<void>;
  /** 로그인된(또는 데모) 실무자 본인 */
  currentEmployee: Employee | null;

  reservations: Reservation[];
  upsertReservation: (r: Reservation) => void;
  deleteReservation: (id: number) => void;
  deleteReservations: (ids: number[]) => void;
  shifts: Shift[];
  setShift: (s: Shift) => void;
  deleteShift: (id: string) => void;
  records: WorkRecord[];
  addRecord: (r: WorkRecord) => void;
  approveRecord: (id: number) => void;
  payroll: PayrollRow[];
  updatePayroll: (empId: number, patch: Partial<PayrollRow>) => void;
  getPayrollPassword: () => Promise<string>;
  setPayrollPassword: (nextPassword: string) => Promise<void>;
  ownerSchedules: OwnerSchedule[];
  upsertOwnerSchedule: (item: OwnerSchedule) => void;
  deleteOwnerSchedule: (id: number) => void;
  notices: Notice[];
  handovers: Notice[];
  upsertNotice: (notice: Notice) => void;
  deleteNotice: (docId: string) => void;
  upsertHandover: (handover: Notice) => void;
  deleteHandover: (docId: string) => void;
  addHandover: (text: string) => void;
  vendors: Vendor[];
  upsertVendor: (vendor: Vendor) => void;
  deleteVendor: (id: number) => void;
  inventoryCategories: InventoryCategoryItem[];
  upsertInventoryCategory: (category: InventoryCategoryItem) => void;
  deleteInventoryCategory: (id: string) => void;
  inventoryItems: InventoryItem[];
  upsertInventoryItem: (item: InventoryItem) => void;
  deleteInventoryItem: (id: number) => void;
  purchaseOrders: PurchaseOrder[];
  upsertPurchaseOrder: (order: PurchaseOrder) => void;
  deletePurchaseOrder: (id: number) => void;
  receivePurchaseOrder: (id: number) => void;
  recipes: Recipe[];
  upsertRecipe: (recipe: Recipe) => void;
  deleteRecipe: (id: number) => void;
  salesOrders: SalesOrder[];
  salesSyncRuns: SalesSyncRun[];
  syncOkposSales: () => Promise<void>;

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
  const [userProfiles, setUserProfiles] = useState<UserProfileDoc[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [records, setRecords] = useState<WorkRecord[]>([]);
  const [payroll, setPayroll] = useState<PayrollRow[]>([]);
  const [ownerSchedules, setOwnerSchedules] = useState<OwnerSchedule[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [handovers, setHandovers] = useState<Notice[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [inventoryCategories, setInventoryCategories] = useState<InventoryCategoryItem[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [salesSyncRuns, setSalesSyncRuns] = useState<SalesSyncRun[]>([]);

  const [punchStatus, setPunchStatus] = useState<PunchStatus>("before");
  const [punchInAt, setPunchInAt] = useState<string | null>(null);
  const [punchOutAt, setPunchOutAt] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [demoPayrollPassword, setDemoPayrollPassword] = useState(() =>
    window.localStorage.getItem("haneulttang.payrollPassword") ?? DEFAULT_PAYROLL_PASSWORD
  );
  const [managerPermissions, setManagerPermissions] = useState<ManagerPermissions>(() =>
    loadDemoManagerPermissions()
  );
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
      const [emp, resv, sh, rec, pay, not, hand, ven, invCats, inv, orders, recipeList, sales, syncRuns] = await Promise.all([
        repository.listEmployees(),
        repository.listReservations(),
        repository.listShifts(),
        repository.listRecords(),
        repository.listPayroll(),
        repository.listNotices(),
        repository.listHandovers(),
        repository.listVendors(),
        repository.listInventoryCategories(),
        repository.listInventoryItems(),
        repository.listPurchaseOrders(),
        repository.listRecipes(),
        repository.listSalesOrders(),
        repository.listSalesSyncRuns(),
      ]);
      setEmployees(emp);
      setReservations(resv);
      setShifts(sh);
      setRecords(rec);
      setPayroll(pay);
      setNotices(not);
      setHandovers(hand);
      setVendors(ven);
      setInventoryCategories(invCats);
      setInventoryItems(inv);
      setPurchaseOrders(orders);
      setRecipes(recipeList);
      setSalesOrders(sales);
      setSalesSyncRuns(syncRuns);
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
        setManagerPermissions(DEFAULT_MANAGER_PERMISSIONS);
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
      setAuthLoading(true); // 프로필 조회 동안 스플래시 유지 (복구화면 깜빡임 방지)
      try {
        const p = await fetchUserProfile(u.uid);
        const adminProfile = isAdminEmail(u.email)
          ? { ...adminProfileForEmail(u.email ?? "관리자"), ...(p ?? {}), role: "admin" as const, active: true }
          : null;
        if (adminProfile) {
          setError(null);
          setProfile(adminProfile);
          setRoleState("admin");
          setAuthLoading(false);
          if (!p || p.role !== "admin" || p.storeId !== adminProfile.storeId || p.active !== true) {
            createUserProfile(u.uid, adminProfile).catch((e) => {
              console.warn("[auth] admin profile bootstrap skipped", e);
            });
          }
          return;
        }
        if (!p) {
          setError(
            `users/${u.uid} 문서가 없습니다. Firebase 콘솔에서 사용자 프로필(role, storeId, employeeId)을 등록해주세요.`
          );
        } else if (!p.active) {
          setError("비활성화된 계정입니다. 관리자에게 문의해주세요.");
        } else {
          setError(null);
          setProfile(adminProfile ?? p);
          setRoleState(adminProfile ? "admin" : p.role);
        }
      } catch (e) {
        setError(`사용자 프로필을 불러오지 못했습니다: ${(e as Error).message}`);
      }
      setAuthLoading(false);
    });
  }, []);

  useEffect(() => {
    if (APP_MODE !== "live" || !profile || (profile.role !== "admin" && profile.role !== "manager")) return;
    return subscribeManagerPermissions(
      setManagerPermissions,
      (e) => {
        console.error("[managerPermissions]", e);
        setError(`매니저 권한 설정을 불러오지 못했습니다: ${e.message}`);
      }
    );
  }, [profile]);

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
    const isAdminRole = profile.role === "admin";
    const isStaffRole = profile.role === "staff";
    const managerCan = (key: ManagerPermissionKey) =>
      profile.role === "manager" && managerPermissions[key] === true;
    const canReservationData = isAdminRole || isStaffRole || managerCan("reservations");
    const canScheduleData = isAdminRole || isStaffRole || managerCan("scheduleManage");
    const canUserProfileData = isAdminRole || managerCan("employees");
    const canVendorData =
      isAdminRole || managerCan("vendors") || managerCan("inventory") || managerCan("settlements") || managerCan("recipes");
    const canInventoryData =
      isAdminRole || managerCan("vendors") || managerCan("inventory") || managerCan("settlements");
    const canRecipeData = isAdminRole || managerCan("recipes");
    const canSalesData = isAdminRole || managerCan("sales");

    if (!canUserProfileData) setUserProfiles([]);
    if (!canReservationData) setReservations([]);
    if (!canScheduleData) {
      setShifts([]);
      setRecords([]);
    }
    if (!canVendorData) setVendors([]);
    if (!canInventoryData) {
      setInventoryCategories([]);
      setInventoryItems([]);
      setPurchaseOrders([]);
    }
    if (!canRecipeData) setRecipes([]);
    if (!canSalesData) {
      setSalesOrders([]);
      setSalesSyncRuns([]);
    }

    let gotFirst = false;
    const markLoaded = () => {
      if (!gotFirst) {
        gotFirst = true;
        setLoading(false);
      }
    };

    const unsubs = [
      subscribeEmployees((v) => { setEmployees(v); markLoaded(); }, onErr),
      ...(canReservationData ? [subscribeReservations(setReservations, onErr)] : []),
      ...(canScheduleData
        ? [
            subscribeShifts(empFilter, setShifts, onErr),
            subscribeRecords(empFilter, setRecords, onErr),
          ]
        : []),
      subscribeNotices(setNotices, onErr),
      subscribeHandovers(setHandovers, onErr),
      // 급여는 관리자만 구독 (staff는 Rules상 본인 문서만 허용, 화면도 없음)
      ...(isAdminRole
        ? [
            subscribePayroll(setPayroll, onErr),
            subscribeOwnerSchedules(setOwnerSchedules, onErr),
          ]
        : []),
      ...(canUserProfileData ? [subscribeUserProfiles(setUserProfiles, onErr)] : []),
      ...(canVendorData ? [subscribeVendors(setVendors, onErr)] : []),
      ...(canInventoryData
        ? [
            subscribeInventoryCategories(setInventoryCategories, onErr),
            subscribeInventoryItems(setInventoryItems, onErr),
            subscribePurchaseOrders(setPurchaseOrders, onErr),
          ]
        : []),
      ...(canRecipeData ? [subscribeRecipes(setRecipes, onErr)] : []),
      ...(canSalesData
        ? [
            subscribeSalesOrders(setSalesOrders, onErr),
            subscribeSalesSyncRuns(setSalesSyncRuns, onErr),
          ]
        : []),
    ];
    return () => unsubs.forEach((u) => u());
  }, [profile, managerPermissions]);

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

  const deleteReservation = useCallback((id: number) => {
    if (APP_MODE === "live") {
      fsDeleteReservation(id).catch(fail("예약 삭제"));
      return;
    }
    void repository.deleteReservation(id);
    setReservations((prev) => prev.filter((r) => r.id !== id));
  }, [fail]);

  const deleteReservations = useCallback((ids: number[]) => {
    if (ids.length === 0) return;
    if (APP_MODE === "live") {
      ids.forEach((id) => fsDeleteReservation(id).catch(fail("예약 삭제")));
      return;
    }
    ids.forEach((id) => void repository.deleteReservation(id));
    const target = new Set(ids);
    setReservations((prev) => prev.filter((r) => !target.has(r.id)));
  }, [fail]);

  const upsertEmployee = useCallback((employee: Employee) => {
    if (APP_MODE === "live") {
      fsUpsertEmployee(employee).catch(fail("직원 저장"));
      return;
    }
    void repository.saveEmployee(employee);
    setEmployees((prev) => {
      const i = prev.findIndex((e) => e.id === employee.id);
      if (i === -1) return [...prev, employee].sort((a, b) => a.id - b.id);
      const next = [...prev];
      next[i] = employee;
      return next.sort((a, b) => a.id - b.id);
    });
  }, [fail]);

  const deactivateUserProfile = useCallback(async (uid: string) => {
    if (APP_MODE === "live") {
      await fsDeactivateUserProfile(uid);
    }
    setUserProfiles((prev) =>
      prev.map((u) => (u.uid === uid ? { ...u, active: false } : u))
    );
  }, []);

  const deleteEmployee = useCallback((id: number) => {
    const employee = employees.find((e) => e.id === id);
    if (APP_MODE === "live") {
      fsDeleteEmployee(id).catch(fail("직원 삭제"));
      if (employee?.uid) {
        fsDeactivateUserProfile(employee.uid).catch(fail("계정 비활성화"));
      }
      return;
    }
    void repository.deleteEmployee(id);
    setEmployees((prev) => prev.filter((e) => e.id !== id));
    if (employee?.uid) {
      setUserProfiles((prev) =>
        prev.map((u) => (u.uid === employee.uid ? { ...u, active: false } : u))
      );
    }
  }, [employees, fail]);

  const setShift = useCallback((s: Shift) => {
    if (APP_MODE === "live") {
      fsSetShift(s).catch(fail("근무표 저장"));
      return;
    }
    void repository.saveShift(s);
    setShifts((prev) => {
      const i = prev.findIndex((x) => x.id === s.id);
      if (i === -1) return [...prev, s].sort(sortShifts);
      const next = [...prev];
      next[i] = s;
      return next.sort(sortShifts);
    });
  }, [fail]);

  const deleteShift = useCallback((id: string) => {
    if (APP_MODE === "live") {
      fsDeleteShift(id).catch(fail("근무표 삭제"));
      return;
    }
    void repository.deleteShift(id);
    setShifts((prev) => prev.filter((s) => s.id !== id));
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

  const upsertOwnerSchedule = useCallback((item: OwnerSchedule) => {
    const normalized: OwnerSchedule = {
      ...item,
      title: item.title.trim(),
      location: item.location?.trim(),
      memo: item.memo?.trim(),
      important: item.important ?? false,
      done: item.done ?? false,
      updatedAt: new Date().toISOString(),
    };
    if (APP_MODE === "live") {
      fsUpsertOwnerSchedule(normalized).catch(fail("대표 일정 저장"));
      return;
    }
    setOwnerSchedules((prev) => {
      const index = prev.findIndex((x) => x.id === normalized.id);
      const next = index === -1
        ? [...prev, normalized]
        : prev.map((x) => (x.id === normalized.id ? normalized : x));
      return next.sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
    });
  }, [fail]);

  const deleteOwnerSchedule = useCallback((id: number) => {
    if (APP_MODE === "live") {
      fsDeleteOwnerSchedule(id).catch(fail("대표 일정 삭제"));
      return;
    }
    setOwnerSchedules((prev) => prev.filter((item) => item.id !== id));
  }, [fail]);

  const upsertVendor = useCallback((vendor: Vendor) => {
    const normalized: Vendor = {
      ...vendor,
      name: vendor.name.trim(),
      businessNumber: vendor.businessNumber.trim(),
      address: vendor.address.trim(),
      active: vendor.active ?? true,
    };
    if (APP_MODE === "live") {
      fsUpsertVendor(normalized).catch(fail("거래처 저장"));
      return;
    }
    void repository.saveVendor(normalized);
    setVendors((prev) => {
      const i = prev.findIndex((v) => v.id === normalized.id);
      if (i === -1) return [...prev, normalized].sort((a, b) => a.name.localeCompare(b.name));
      const next = [...prev];
      next[i] = normalized;
      return next.sort((a, b) => a.name.localeCompare(b.name));
    });
  }, [fail]);

  const deleteVendor = useCallback((id: number) => {
    if (APP_MODE === "live") {
      fsDeleteVendor(id).catch(fail("거래처 삭제"));
      return;
    }
    void repository.deleteVendor(id);
    setVendors((prev) => prev.filter((v) => v.id !== id));
  }, [fail]);

  const upsertInventoryCategory = useCallback((category: InventoryCategoryItem) => {
    const normalized: InventoryCategoryItem = {
      ...category,
      id: category.id.trim(),
      name: category.name.trim(),
      updatedAt: new Date().toISOString(),
    };
    if (!normalized.id || !normalized.name) return;
    if (APP_MODE === "live") {
      fsUpsertInventoryCategory(normalized).catch(fail("재고 카테고리 저장"));
      return;
    }
    void repository.saveInventoryCategory(normalized);
    setInventoryCategories((prev) => {
      const i = prev.findIndex((x) => x.id === normalized.id);
      const next = i === -1
        ? [...prev, normalized]
        : prev.map((x) => (x.id === normalized.id ? normalized : x));
      return next.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
    });
  }, [fail]);

  const deleteInventoryCategory = useCallback((id: string) => {
    if (APP_MODE === "live") {
      fsDeleteInventoryCategory(id).catch(fail("재고 카테고리 삭제"));
      return;
    }
    void repository.deleteInventoryCategory(id);
    setInventoryCategories((prev) => prev.filter((category) => category.id !== id));
  }, [fail]);

  const upsertInventoryItem = useCallback((item: InventoryItem) => {
    const normalized: InventoryItem = {
      ...item,
      name: item.name.trim(),
      unit: item.unit.trim(),
      currentQty: Number(item.currentQty) || 0,
      minQty: Number(item.minQty) || 0,
      defaultOrderQty: Number(item.defaultOrderQty) || 0,
      unitPrice: Number(item.unitPrice) || 0,
      memo: item.memo?.trim(),
      active: item.active ?? true,
      updatedAt: new Date().toISOString(),
    };
    if (APP_MODE === "live") {
      fsUpsertInventoryItem(normalized).catch(fail("재고 품목 저장"));
      return;
    }
    void repository.saveInventoryItem(normalized);
    setInventoryItems((prev) => {
      const i = prev.findIndex((x) => x.id === normalized.id);
      if (i === -1) return [...prev, normalized].sort((a, b) => a.vendorId - b.vendorId || a.name.localeCompare(b.name));
      const next = [...prev];
      next[i] = normalized;
      return next.sort((a, b) => a.vendorId - b.vendorId || a.name.localeCompare(b.name));
    });
  }, [fail]);

  const deleteInventoryItem = useCallback((id: number) => {
    if (APP_MODE === "live") {
      fsDeleteInventoryItem(id).catch(fail("재고 품목 삭제"));
      return;
    }
    void repository.deleteInventoryItem(id);
    setInventoryItems((prev) => prev.filter((item) => item.id !== id));
  }, [fail]);

  const upsertPurchaseOrder = useCallback((order: PurchaseOrder) => {
    const items = order.items.map((item) => ({
      ...item,
      qty: Number(item.qty) || 0,
      unitPrice: Number(item.unitPrice) || 0,
      totalPrice: (Number(item.qty) || 0) * (Number(item.unitPrice) || 0),
    }));
    const normalized: PurchaseOrder = {
      ...order,
      items,
      totalAmount: items.reduce((sum, item) => sum + item.totalPrice, 0),
      memo: order.memo?.trim(),
    };
    if (APP_MODE === "live") {
      fsUpsertPurchaseOrder(normalized).catch(fail("발주서 저장"));
      return;
    }
    void repository.savePurchaseOrder(normalized);
    setPurchaseOrders((prev) => {
      const i = prev.findIndex((x) => x.id === normalized.id);
      if (i === -1) return [normalized, ...prev].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
      const next = [...prev];
      next[i] = normalized;
      return next.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
    });
  }, [fail]);

  const deletePurchaseOrder = useCallback((id: number) => {
    if (APP_MODE === "live") {
      fsDeletePurchaseOrder(id).catch(fail("발주서 삭제"));
      return;
    }
    void repository.deletePurchaseOrder(id);
    setPurchaseOrders((prev) => prev.filter((order) => order.id !== id));
  }, [fail]);

  const receivePurchaseOrder = useCallback((id: number) => {
    const order = purchaseOrders.find((x) => x.id === id);
    if (!order || order.status === "received") return;
    const now = new Date().toISOString();
    const updatedItems: InventoryItem[] = [];
    const logs: StockLog[] = [];

    order.items.forEach((line) => {
      const item = inventoryItems.find((x) => x.id === line.inventoryItemId);
      if (!item) return;
      const beforeQty = Number(item.currentQty) || 0;
      const qty = Number(line.qty) || 0;
      const afterQty = beforeQty + qty;
      updatedItems.push({ ...item, currentQty: afterQty, updatedAt: now });
      logs.push({
        id: `${order.id}_${line.inventoryItemId}_${Date.now()}`,
        inventoryItemId: line.inventoryItemId,
        type: "in",
        qty,
        beforeQty,
        afterQty,
        memo: `${order.vendorName} 입고`,
        createdAt: now,
        createdBy: profile?.name ?? "관리자",
        purchaseOrderId: order.id,
      });
    });

    const received: PurchaseOrder = { ...order, status: "received", receivedAt: now };
    if (APP_MODE === "live") {
      fsReceivePurchaseOrder(received, updatedItems, logs).then(() => {
        showToast("입고 처리했습니다");
      }).catch(fail("입고 처리"));
      return;
    }

    updatedItems.forEach((item) => void repository.saveInventoryItem(item));
    void repository.savePurchaseOrder(received);
    setInventoryItems((prev) =>
      prev.map((item) => updatedItems.find((updated) => updated.id === item.id) ?? item)
    );
    setPurchaseOrders((prev) =>
      prev.map((orderItem) => (orderItem.id === id ? received : orderItem))
    );
    showToast("입고 처리했습니다");
  }, [fail, inventoryItems, profile, purchaseOrders, showToast]);

  const upsertRecipe = useCallback((recipe: Recipe) => {
    const normalized: Recipe = {
      ...recipe,
      name: recipe.name.trim(),
      category: recipe.category.trim(),
      servings: Math.max(1, Number(recipe.servings) || 1),
      ingredients: recipe.ingredients.map((ingredient) => ({
        ...ingredient,
        name: ingredient.name.trim(),
        quantity: Number(ingredient.quantity) || 0,
        unitCost: Number(ingredient.unitCost) || 0,
      })),
      laborCost: Number(recipe.laborCost) || 0,
      overheadCost: Number(recipe.overheadCost) || 0,
      salePrice: Number(recipe.salePrice) || 0,
      active: recipe.active ?? true,
    };
    if (APP_MODE === "live") {
      fsUpsertRecipe(normalized).catch(fail("레시피 저장"));
      return;
    }
    void repository.saveRecipe(normalized);
    setRecipes((prev) => {
      const i = prev.findIndex((r) => r.id === normalized.id);
      if (i === -1) return [...prev, normalized].sort((a, b) => a.name.localeCompare(b.name));
      const next = [...prev];
      next[i] = normalized;
      return next.sort((a, b) => a.name.localeCompare(b.name));
    });
  }, [fail]);

  const deleteRecipe = useCallback((id: number) => {
    if (APP_MODE === "live") {
      fsDeleteRecipe(id).catch(fail("레시피 삭제"));
      return;
    }
    void repository.deleteRecipe(id);
    setRecipes((prev) => prev.filter((r) => r.id !== id));
  }, [fail]);

  const syncOkposSales = useCallback(async () => {
    if (APP_MODE === "live") {
      const result = await fsSyncOkposSales();
      showToast(result.message);
      return;
    }
    const run: SalesSyncRun = {
      id: `manual-${Date.now()}`,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "success",
      importedCount: 0,
      updatedCount: salesOrders.length,
      rangeStart: TODAY_STR,
      rangeEnd: TODAY_STR,
      message: "데모 모드에서는 샘플 매출을 사용합니다.",
    };
    setSalesSyncRuns((prev) => [run, ...prev].slice(0, 20));
    showToast("데모 매출 동기화 로그를 남겼습니다");
  }, [salesOrders.length, showToast]);

  const getPayrollPassword = useCallback(async () => {
    if (APP_MODE === "live") {
      return fsGetPayrollPassword();
    }
    return demoPayrollPassword;
  }, [demoPayrollPassword]);

  const setPayrollPassword = useCallback(async (nextPassword: string) => {
    if (APP_MODE === "live") {
      await fsSetPayrollPassword(nextPassword);
    } else {
      window.localStorage.setItem("haneulttang.payrollPassword", nextPassword);
    }
    setDemoPayrollPassword(nextPassword);
  }, []);

  const updateManagerPermissions = useCallback(async (next: ManagerPermissions) => {
    const normalized = normalizeManagerPermissions(next);
    if (APP_MODE === "live") {
      await fsSetManagerPermissions(normalized);
    } else {
      window.localStorage.setItem("haneulttang.managerPermissions", JSON.stringify(normalized));
    }
    setManagerPermissions(normalized);
    showToast("매니저 권한 설정을 저장했습니다");
  }, [showToast]);

  const canManagerAccess = useCallback((key: ManagerPermissionKey) => {
    return managerPermissions[key] === true;
  }, [managerPermissions]);

  const updateUserRole = useCallback(async (uid: string, nextRole: Role) => {
    if (nextRole === "admin") {
      throw new Error("관리자 권한은 Firebase 콘솔에서 직접 부여해주세요.");
    }
    if (APP_MODE === "live") {
      await fsUpdateUserRole(uid, nextRole);
    }
    setUserProfiles((prev) =>
      prev.map((u) => (u.uid === uid ? { ...u, role: nextRole } : u))
    );
    showToast(nextRole === "manager" ? "매니저 권한을 부여했습니다" : "실무자 권한으로 변경했습니다");
  }, [showToast]);

  const upsertNotice = useCallback((notice: Notice) => {
    if (APP_MODE === "live") {
      fsUpsertNotice(notice).catch(fail("공지 저장"));
      return;
    }
    void repository.saveNotice(notice);
    setNotices((prev) => {
      const i = prev.findIndex((n) => n.id === notice.id);
      if (i === -1) return [notice, ...prev].sort((a, b) => b.id - a.id);
      const next = [...prev];
      next[i] = notice;
      return next.sort((a, b) => b.id - a.id);
    });
  }, [fail]);

  const deleteNotice = useCallback((docId: string) => {
    if (APP_MODE === "live") {
      fsDeleteNotice(docId).catch(fail("공지 삭제"));
      return;
    }
    const id = Number(docId);
    void repository.deleteNotice(id);
    setNotices((prev) => prev.filter((n) => n.id !== id && n.docId !== docId));
  }, [fail]);

  const upsertHandover = useCallback((handover: Notice) => {
    if (APP_MODE === "live") {
      fsUpsertHandover(handover, profile?.name ?? "unknown").catch(fail("전달사항 저장"));
      return;
    }
    void repository.saveHandover(handover);
    setHandovers((prev) => {
      const i = prev.findIndex((h) => h.id === handover.id);
      if (i === -1) return [handover, ...prev].sort((a, b) => b.id - a.id);
      const next = [...prev];
      next[i] = handover;
      return next.sort((a, b) => b.id - a.id);
    });
  }, [fail, profile]);

  const deleteHandover = useCallback((docId: string) => {
    if (APP_MODE === "live") {
      fsDeleteHandover(docId).catch(fail("전달사항 삭제"));
      return;
    }
    const id = Number(docId);
    void repository.deleteHandover(id);
    setHandovers((prev) => prev.filter((h) => h.id !== id && h.docId !== docId));
  }, [fail]);

  const addHandover = useCallback((text: string) => {
    const id = Date.now();
    const n: Notice = { id, docId: String(id), text, date: TODAY_STR.slice(5) };
    if (APP_MODE === "live") {
      fsUpsertHandover(n, profile?.name ?? "unknown").catch(fail("전달사항 등록"));
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

  const login = useCallback(async (
    email: string,
    password: string,
    rememberLogin = true
  ) => {
    await signInEmail(email, password, rememberLogin);
  }, []);

  const signup = useCallback(
    async (data: {
      name: string; email: string; password: string; phone: string;
      address: string; residentRegistrationNumber: string; bank: string; account: string;
    }) => {
      signupInProgress.current = true;
      try {
        const { uid, email: createdEmail } = await signUpEmail(data.email, data.password);
        try {
          const { profile: newProfile } = await createStaffProfile(uid, {
            name: data.name,
            phone: data.phone,
            address: data.address,
            residentRegistrationNumber: data.residentRegistrationNumber,
            bank: data.bank,
            account: data.account,
          });
          setProfile(newProfile);
          setRoleState("staff");
          setError(null);
          setAuthUser({ uid, email: createdEmail });
          showToast("회원가입이 완료되었습니다.");
        } catch (profileError) {
          console.error("[signup] profile create failed", profileError);
          await signOutUser().catch(() => undefined);
          setAuthUser(null);
          setProfile(null);
          setError("프로필 저장 중 오류가 발생했습니다. 같은 이메일로 로그인하면 복구 화면이 나타납니다.");
          throw { code: "profile-create-failed" };
        }
      } finally {
        signupInProgress.current = false;
      }
    },
    [showToast]
  );

  const completeProfile = useCallback(
    async (data: {
      name: string; phone: string; address: string; residentRegistrationNumber: string; bank: string; account: string;
    }) => {
      if (!authUser) throw new Error("로그인이 필요합니다.");
      const { profile: newProfile } = await createStaffProfile(authUser.uid, data);
      setProfile(newProfile);
      setRoleState("staff");
      setError(null);
      showToast("프로필이 완성되었습니다.");
    },
    [authUser, showToast]
  );

  const updateMyProfile = useCallback(
    async (data: {
      name: string; phone: string; address: string; residentRegistrationNumber: string; bank: string; account: string;
    }) => {
      if (APP_MODE === "live") {
        if (!authUser || !profile) throw new Error("로그인이 필요합니다.");
        await fsUpdateMyProfile(authUser.uid, profile.employeeId, data);
      }
      setProfile((prev) => (prev ? { ...prev, ...data } : prev));
      setEmployees((prev) =>
        prev.map((employee) =>
          employee.id === (APP_MODE === "demo" ? CURRENT_STAFF_ID : profile?.employeeId)
            ? { ...employee, ...data }
            : employee
        )
      );
      showToast("내 정보를 저장했습니다");
    },
    [authUser, profile, showToast]
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
      role, setRole, managerPermissions, updateManagerPermissions, canManagerAccess,
      authUser, profile, authLoading, login, signup, completeProfile, updateMyProfile, logout,
      loading, error,
      employees, upsertEmployee, deleteEmployee, deactivateUserProfile,
      userProfiles, updateUserRole, currentEmployee,
      reservations, upsertReservation, deleteReservation, deleteReservations,
      shifts, setShift,
      deleteShift,
      records, addRecord, approveRecord,
      payroll, updatePayroll, getPayrollPassword, setPayrollPassword,
      ownerSchedules, upsertOwnerSchedule, deleteOwnerSchedule,
      notices, handovers, upsertNotice, deleteNotice, upsertHandover, deleteHandover, addHandover,
      vendors, upsertVendor, deleteVendor,
      inventoryCategories, upsertInventoryCategory, deleteInventoryCategory,
      inventoryItems, upsertInventoryItem, deleteInventoryItem,
      purchaseOrders, upsertPurchaseOrder, deletePurchaseOrder, receivePurchaseOrder,
      recipes, upsertRecipe, deleteRecipe,
      salesOrders, salesSyncRuns, syncOkposSales,
      punchStatus, punchInAt, punchOutAt, punchIn, punchOut,
      toast, showToast,
    }),
    [demoReason, role, setRole, managerPermissions, updateManagerPermissions, canManagerAccess,
     authUser, profile, authLoading, login, signup, completeProfile, updateMyProfile, logout,
     loading, error, employees, userProfiles, updateUserRole, currentEmployee,
     reservations, shifts, records, payroll, ownerSchedules, notices, handovers, vendors, inventoryCategories, inventoryItems, purchaseOrders, recipes, salesOrders, salesSyncRuns,
     punchStatus, punchInAt, punchOutAt, toast,
     upsertEmployee, deleteEmployee, deactivateUserProfile,
     upsertReservation, deleteReservation, deleteReservations,
     setShift, deleteShift, addRecord, approveRecord, updatePayroll,
     getPayrollPassword, setPayrollPassword,
     upsertOwnerSchedule, deleteOwnerSchedule,
     upsertNotice, deleteNotice, upsertHandover, deleteHandover, addHandover,
     upsertVendor, deleteVendor,
     upsertInventoryCategory, deleteInventoryCategory,
     upsertInventoryItem, deleteInventoryItem,
     upsertPurchaseOrder, deletePurchaseOrder, receivePurchaseOrder,
     upsertRecipe, deleteRecipe,
     syncOkposSales,
     punchIn, punchOut, showToast]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider missing");
  return s;
}
