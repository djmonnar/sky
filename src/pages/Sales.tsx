import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Badge, Card, StatCard } from "../components/ui";
import { TODAY_STR } from "../lib/time";
import {
  hourlySales,
  latestSyncRun,
  menuSales,
  money,
  ORDER_STATUS_LABEL,
  ORDER_TYPE_LABEL,
  ordersForDate,
  PAYMENT_LABEL,
  paymentTotals,
  salesSummary,
} from "../lib/sales";
import type { SalesOrder } from "../data/types";

function statusTone(status: SalesOrder["status"]): string {
  if (status === "paid") return "green";
  if (status === "partialRefund") return "amber";
  return "red";
}

export default function Sales() {
  const { salesOrders, salesSyncRuns, syncOkposSales, mode, showToast } = useStore();
  const [date, setDate] = useState(TODAY_STR);
  const [syncing, setSyncing] = useState(false);
  const orders = useMemo(() => ordersForDate(salesOrders, date), [salesOrders, date]);
  const summary = useMemo(() => salesSummary(orders), [orders]);
  const payments = useMemo(() => paymentTotals(orders), [orders]);
  const hourly = useMemo(() => hourlySales(orders), [orders]);
  const menus = useMemo(() => menuSales(orders), [orders]);
  const latestRun = latestSyncRun(salesSyncRuns);

  const runSync = async () => {
    setSyncing(true);
    try {
      await syncOkposSales();
    } catch (e) {
      showToast((e as Error).message || "매출 동기화에 실패했습니다");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <>
      <div className="grid grid-4">
        <StatCard label="선택일 매출" value={money(summary.netAmount)} unit="원" trend={`${summary.orderCount}건`} trendUp icon="💳" />
        <StatCard label="객단가" value={money(summary.averageOrderAmount)} unit="원" trend="결제완료 기준" trendUp icon="🧾" tone="blue" />
        <StatCard label="취소/환불" value={money(summary.refundAmount)} unit="원" trend={`${summary.canceledCount}건`} trendUp={false} icon="↩️" tone="amber" />
        <StatCard label="할인" value={money(summary.discountAmount)} unit="원" trend="POS 원장 기준" trendUp={false} icon="🏷️" />
      </div>

      <Card
        title="OK포스 매출 동기화"
        icon="🔄"
        action={<button className="btn btn-primary btn-sm" disabled={syncing} onClick={runSync}>{syncing ? "동기화 중..." : "지금 동기화"}</button>}
      >
        <div className="sales-sync-panel">
          <label>
            <span className="field-label">조회일</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div>
            <div className="field-label">마지막 동기화</div>
            <div className="bold">
              {latestRun?.finishedAt || latestRun?.startedAt || "아직 없음"}
              {latestRun && <Badge tone={latestRun.status === "success" ? "green" : latestRun.status === "config_required" ? "amber" : "red"}>{latestRun.status}</Badge>}
            </div>
            <div className="muted small">
              {latestRun?.message ?? (mode === "demo" ? "데모 모드에서는 샘플 매출을 보여줍니다." : "OK포스 API 설정 후 자동 수집됩니다.")}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-main-side">
        <div className="stack">
          <Card title="주문 원장" icon="📑">
            <div className="table-wrap">
              <table className="data-table sales-table">
                <thead>
                  <tr>
                    <th>시간</th>
                    <th>주문번호</th>
                    <th>구분</th>
                    <th>테이블</th>
                    <th>메뉴</th>
                    <th>결제</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td className="num">{order.soldAt.slice(11, 16) || "-"}</td>
                      <td className="num">{order.okposOrderId}</td>
                      <td>{order.orderType ? ORDER_TYPE_LABEL[order.orderType] : "-"}</td>
                      <td>{order.tableName || "-"}</td>
                      <td>{order.items.slice(0, 2).map((item) => `${item.name} ${item.quantity}`).join(", ")}{order.items.length > 2 ? " 외" : ""}</td>
                      <td className="num bold">{money(order.paidAmount)}원</td>
                      <td><Badge tone={statusTone(order.status)}>{ORDER_STATUS_LABEL[order.status]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {orders.length === 0 && <div className="muted small empty-note">선택한 날짜의 주문 원장이 없습니다.</div>}
            </div>
          </Card>
        </div>

        <div className="stack side-panel">
          <Card title="결제수단별 매출" icon="💳">
            {payments.map((payment) => (
              <div className="pay-line" key={payment.method}>
                <span className="k">{PAYMENT_LABEL[payment.method]}</span>
                <span className="v">{money(payment.amount)}원</span>
              </div>
            ))}
            {payments.length === 0 && <div className="muted small">결제 내역이 없습니다.</div>}
          </Card>

          <Card title="시간대별 매출" icon="⏱️">
            {hourly.map((row) => (
              <div className="pay-line" key={row.label}>
                <span className="k">{row.label}</span>
                <span className="v">{money(row.amount)}원</span>
              </div>
            ))}
            {hourly.length === 0 && <div className="muted small">시간대 집계가 없습니다.</div>}
          </Card>

          <Card title="메뉴별 매출" icon="🍲">
            {menus.slice(0, 8).map((row) => (
              <div className="pay-line" key={row.name}>
                <span className="k">{row.name} <span className="muted small">x{row.quantity}</span></span>
                <span className="v">{money(row.amount)}원</span>
              </div>
            ))}
            {menus.length === 0 && <div className="muted small">메뉴별 집계가 없습니다.</div>}
          </Card>
        </div>
      </div>
    </>
  );
}
