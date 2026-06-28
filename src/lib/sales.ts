import type { SalesOrder, SalesPayment, SalesSyncRun } from "../data/types";
import { TODAY_STR } from "./time";

export const PAYMENT_LABEL: Record<SalesPayment["method"], string> = {
  card: "카드",
  cash: "현금",
  simplePay: "간편결제",
  voucher: "상품권",
  other: "기타",
};

export const ORDER_STATUS_LABEL: Record<SalesOrder["status"], string> = {
  paid: "결제완료",
  canceled: "취소",
  refunded: "환불",
  partialRefund: "부분환불",
  voided: "무효",
};

export const ORDER_TYPE_LABEL: Record<NonNullable<SalesOrder["orderType"]>, string> = {
  dineIn: "매장",
  takeout: "포장",
  delivery: "배달",
  other: "기타",
};

export function money(value: number): string {
  return Math.round(value).toLocaleString("ko-KR");
}

export function activeSalesOrders(orders: SalesOrder[]): SalesOrder[] {
  return orders.filter((order) => order.status === "paid" || order.status === "partialRefund");
}

export function ordersForDate(orders: SalesOrder[], date = TODAY_STR): SalesOrder[] {
  return orders
    .filter((order) => order.businessDate === date)
    .sort((a, b) => b.soldAt.localeCompare(a.soldAt));
}

export function netSales(order: SalesOrder): number {
  if (order.status === "canceled" || order.status === "voided") return 0;
  return Math.max(0, Number(order.paidAmount ?? 0) - Number(order.refundAmount ?? 0));
}

export function salesSummary(orders: SalesOrder[]) {
  const active = activeSalesOrders(orders);
  const netAmount = active.reduce((sum, order) => sum + netSales(order), 0);
  const grossAmount = orders.reduce((sum, order) => sum + Number(order.totalAmount ?? 0), 0);
  const discountAmount = orders.reduce((sum, order) => sum + Number(order.discountAmount ?? 0), 0);
  const refundAmount = orders.reduce((sum, order) => sum + Number(order.refundAmount ?? 0), 0);
  return {
    orderCount: active.length,
    canceledCount: orders.length - active.length,
    grossAmount,
    discountAmount,
    refundAmount,
    netAmount,
    averageOrderAmount: active.length ? Math.round(netAmount / active.length) : 0,
  };
}

export function paymentTotals(orders: SalesOrder[]): SalesPayment[] {
  const totals = new Map<SalesPayment["method"], number>();
  activeSalesOrders(orders).forEach((order) => {
    order.paymentMethods.forEach((payment) => {
      totals.set(payment.method, (totals.get(payment.method) ?? 0) + Number(payment.amount ?? 0));
    });
  });
  return [...totals.entries()]
    .map(([method, amount]) => ({ method, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export function hourlySales(orders: SalesOrder[]) {
  const totals = new Map<string, number>();
  activeSalesOrders(orders).forEach((order) => {
    const hour = (order.soldAt.match(/T(\d{2})/) ?? order.soldAt.match(/\s(\d{2})/))?.[1] ?? "--";
    const label = hour === "--" ? "기타" : `${hour}시`;
    totals.set(label, (totals.get(label) ?? 0) + netSales(order));
  });
  return [...totals.entries()].map(([label, amount]) => ({ label, amount }));
}

export function menuSales(orders: SalesOrder[]) {
  const totals = new Map<string, { quantity: number; amount: number }>();
  activeSalesOrders(orders).forEach((order) => {
    order.items.forEach((item) => {
      const prev = totals.get(item.name) ?? { quantity: 0, amount: 0 };
      totals.set(item.name, {
        quantity: prev.quantity + Number(item.quantity ?? 0),
        amount: prev.amount + Number(item.totalAmount ?? 0),
      });
    });
  });
  return [...totals.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => b.amount - a.amount);
}

export function latestSyncRun(runs: SalesSyncRun[]): SalesSyncRun | null {
  return [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
}
