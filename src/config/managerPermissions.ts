import type { ManagerPermissionKey, ManagerPermissions } from "../data/types";

export interface ManagerPermissionOption {
  key: ManagerPermissionKey;
  label: string;
  description: string;
  locked?: boolean;
}

export const DEFAULT_MANAGER_PERMISSIONS: ManagerPermissions = {
  dashboard: true,
  reservations: true,
  scheduleManage: true,
  employees: false,
  sales: false,
  vendors: false,
  inventory: false,
  settlements: false,
  recipes: false,
  notices: true,
  guide: true,
};

export const MANAGER_PERMISSION_OPTIONS: ManagerPermissionOption[] = [
  {
    key: "dashboard",
    label: "대시보드",
    description: "매니저 로그인 후 기본 화면입니다.",
    locked: true,
  },
  {
    key: "reservations",
    label: "예약 관리",
    description: "예약 조회, 등록, 수정, 방문완료 처리",
  },
  {
    key: "scheduleManage",
    label: "근무표 관리",
    description: "근무표 조회, 직원 배치, 근무기록 확인",
  },
  {
    key: "employees",
    label: "직원 관리",
    description: "직원 목록과 직원 정보 조회/수정",
  },
  {
    key: "sales",
    label: "매출 관리",
    description: "OK포스 매출 요약과 동기화 내역 확인",
  },
  {
    key: "vendors",
    label: "거래처/발주",
    description: "거래처, 거래처별 발주 품목, 발주서 관리",
  },
  {
    key: "inventory",
    label: "재고 관리",
    description: "재고 품목, 카테고리, OCR 입고 등록",
  },
  {
    key: "settlements",
    label: "정산 관리",
    description: "발주 금액 정산, 미정산/완료 처리",
  },
  {
    key: "recipes",
    label: "레시피 원가",
    description: "레시피 등록과 원가 계산",
  },
  {
    key: "notices",
    label: "공지/전달사항",
    description: "공지사항과 전달사항 등록/수정/삭제",
  },
  {
    key: "guide",
    label: "사용 가이드",
    description: "관리자/매니저용 사용 가이드 확인",
  },
];

export function normalizeManagerPermissions(raw?: Partial<ManagerPermissions> | null): ManagerPermissions {
  return MANAGER_PERMISSION_OPTIONS.reduce<ManagerPermissions>((next, option) => {
    next[option.key] = option.locked ? true : raw?.[option.key] ?? DEFAULT_MANAGER_PERMISSIONS[option.key];
    return next;
  }, { ...DEFAULT_MANAGER_PERMISSIONS });
}
