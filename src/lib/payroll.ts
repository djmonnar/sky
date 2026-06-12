import type { Employee, PayrollRow } from "../data/types";

export function isMonthlyEmployee(employee: Employee | null | undefined): boolean {
  return employee?.employmentType === "fullTime" || employee?.salaryType === "monthly";
}

export function isSlotPaidEmployee(employee: Employee | null | undefined): boolean {
  return employee?.salaryType === "perSlot";
}

export function employmentLabel(employee: Employee): string {
  return isMonthlyEmployee(employee) ? "정직원" : "아르바이트";
}

export function salaryTypeLabel(employee: Employee): string {
  if (isSlotPaidEmployee(employee)) return "건별수당";
  return isMonthlyEmployee(employee) ? "월급" : "시급";
}

export function basePay(row: PayrollRow, employee: Employee | null | undefined): number {
  if (!employee) return row.base;
  if (isMonthlyEmployee(employee)) {
    return employee.monthlySalary ?? row.base;
  }
  if (isSlotPaidEmployee(employee)) {
    return (row.slotCount ?? 0) * (row.slotRate ?? employee.slotRate ?? 0);
  }
  return row.hours * employee.hourly;
}

export function finalPay(row: PayrollRow, employee: Employee | null | undefined): number {
  return basePay(row, employee) + row.extra - row.deduct;
}

export function payBasisLabel(employee: Employee): string {
  if (isMonthlyEmployee(employee)) {
    return `월급 ${(employee.monthlySalary ?? 0).toLocaleString()}원`;
  }
  if (isSlotPaidEmployee(employee)) {
    return `슬롯당 ${(employee.slotRate ?? 0).toLocaleString()}원`;
  }
  return `시급 ${employee.hourly.toLocaleString()}원`;
}

export function workHoursLabel(row: PayrollRow, employee: Employee | null | undefined): string {
  if (isMonthlyEmployee(employee)) return "미집계";
  if (isSlotPaidEmployee(employee)) return `${row.slotCount ?? 0}슬롯`;
  return `${row.hours}시간`;
}
