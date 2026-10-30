import type {
  ManagerPermissionKey, ManagerPermissions, Role, StaffPermissionKey, StaffPermissions,
} from "../data/types";
import { MANAGER_PERMISSION_OPTIONS } from "./managerPermissions";

/*
  실무자 권한 — 관리자 모드에서 사장님이 실무자에게 화면을 더 열어 준다(2026-10-30 사장님 요청).

  매니저 권한과 **같은 열쇠**(scheduleManage·inventory …)를 쓴다. 화면(메뉴·주소)과 Firestore 규칙이
  같은 이름으로 보므로, 「재고 관리」를 켜면 매니저가 그 권한으로 하는 일을 실무자도 한다.
  실무자 기본 화면(대시보드·오늘 예약·근무표·근무기록·체크리스트)은 끌 수 없고 여기 안 든다.
*/

export const DEFAULT_STAFF_PERMISSIONS: StaffPermissions = {
  scheduleManage: false,
  employees: false,
  sales: false,
  vendors: false,
  inventory: false,
  settlements: false,
  recipes: false,
  notices: false,
  guide: false,
};

const STAFF_KEYS = Object.keys(DEFAULT_STAFF_PERMISSIONS) as StaffPermissionKey[];

/** 실무자는 늘 쓰는 화면. 끌 수 없어 체크 칸 대신 «기본»으로만 보여 준다. */
export const STAFF_BASE_FEATURES: { label: string; description: string }[] = [
  { label: "대시보드", description: "출퇴근·휴게 기록, 오늘 예약, 전달사항" },
  { label: "오늘 예약", description: "예약 보기·등록·상태 변경 (지우기는 관리자·매니저)" },
  { label: "근무표", description: "본인 근무표 보기" },
  { label: "근무기록", description: "근무기록 작성, 월말 근무내역 제출" },
  { label: "체크리스트", description: "오픈·마감 체크, 특이사항" },
];

/** 실무자에게 열면 무엇이 달라지는지 — 매니저 설명과 다른 것만 따로 적는다. */
const STAFF_DESCRIPTION: Partial<Record<StaffPermissionKey, string>> = {
  scheduleManage: "전체 근무표 조회, 직원 배치, 근무기록 확인 (안 켜면 본인 근무표만)",
  employees: "직원 목록과 정보 조회/수정 — 주민등록번호·계좌 같은 개인정보가 보입니다",
  guide: "사용 가이드 확인",
};

export const STAFF_PERMISSION_OPTIONS = MANAGER_PERMISSION_OPTIONS
  .filter((option): option is typeof option & { key: StaffPermissionKey } =>
    (STAFF_KEYS as string[]).includes(option.key))
  .map((option) => ({ ...option, locked: false, description: STAFF_DESCRIPTION[option.key] ?? option.description }));

export function isStaffPermissionKey(key: string): key is StaffPermissionKey {
  return (STAFF_KEYS as string[]).includes(key);
}

export function normalizeStaffPermissions(raw?: Partial<StaffPermissions> | null): StaffPermissions {
  return STAFF_KEYS.reduce<StaffPermissions>((next, key) => {
    next[key] = raw?.[key] === true;
    return next;
  }, { ...DEFAULT_STAFF_PERMISSIONS });
}

/**
 * 이 역할이 이 화면(권한 열쇠)을 쓸 수 있는가 — 메뉴·주소·데이터 구독이 모두 이 한 함수로 묻는다.
 * 관리자는 전부, 매니저는 매니저 권한, 실무자는 실무자 권한. 실무자 기본 화면(대시보드·오늘 예약)은
 * 열쇠가 아니라 역할로 따로 연다(App.tsx).
 */
export function roleCan(
  role: Role,
  key: ManagerPermissionKey,
  manager: ManagerPermissions,
  staff: StaffPermissions,
): boolean {
  if (role === "admin") return true;
  if (role === "manager") return manager[key] === true;
  if (role === "staff") return isStaffPermissionKey(key) && staff[key] === true;
  return false;
}
