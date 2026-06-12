import type { Employee, PayrollRow } from "../data/types";

export function isMonthlyEmployee(employee: Employee | null | undefined): boolean {
  return employee?.employmentType === "fullTime" || employee?.salaryType === "monthly";
}

export function employmentLabel(employee: Employee): string {
  return isMonthlyEmployee(employee) ? "정직원" : "아르바이트";
}

export function salaryTypeLabel(employee: Employee): string {
  return isMonthlyEmployee(employee) ? "월급" : "시급";
}

export function basePay(row: PayrollRow, employee: Employee | null | undefined): number {
  if (!employee) return row.base;
  if (isMonthlyEmployee(employee)) {
    return employee.monthlySalary ?? row.base;
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
  return `시급 ${employee.hourly.toLocaleString()}원`;
}

export function workHoursLabel(row: PayrollRow, employee: Employee | null | undefined): string {
  if (isMonthlyEmployee(employee)) return "미집계";
  return `${row.hours}시간`;
}
