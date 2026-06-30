import type { Employee, PayrollRow } from "../data/types";

export const SOCIAL_INSURANCE_RATES = {
  nationalPension: 0.0475,
  healthInsurance: 0.03595,
  longTermCare: 0.004724,
  employmentInsurance: 0.009,
};

export const SOCIAL_INSURANCE_TOTAL_RATE =
  SOCIAL_INSURANCE_RATES.nationalPension
  + SOCIAL_INSURANCE_RATES.healthInsurance
  + SOCIAL_INSURANCE_RATES.longTermCare
  + SOCIAL_INSURANCE_RATES.employmentInsurance;

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

export function grossPay(row: PayrollRow, employee: Employee | null | undefined): number {
  return basePay(row, employee) + row.extra;
}

export function socialInsuranceDeduction(row: PayrollRow, employee: Employee | null | undefined): number {
  if (!employee?.socialInsurance) return 0;
  return Math.round(Math.max(0, grossPay(row, employee)) * SOCIAL_INSURANCE_TOTAL_RATE);
}

export function socialInsuranceBreakdown(row: PayrollRow, employee: Employee | null | undefined) {
  const gross = employee?.socialInsurance ? Math.max(0, grossPay(row, employee)) : 0;
  return {
    nationalPension: Math.round(gross * SOCIAL_INSURANCE_RATES.nationalPension),
    healthInsurance: Math.round(gross * SOCIAL_INSURANCE_RATES.healthInsurance),
    longTermCare: Math.round(gross * SOCIAL_INSURANCE_RATES.longTermCare),
    employmentInsurance: Math.round(gross * SOCIAL_INSURANCE_RATES.employmentInsurance),
    total: socialInsuranceDeduction(row, employee),
  };
}

export function finalPay(row: PayrollRow, employee: Employee | null | undefined): number {
  return grossPay(row, employee) - row.deduct - socialInsuranceDeduction(row, employee);
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
