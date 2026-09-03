import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Badge, Card, StatCard } from "../components/ui";
import GranterFinanceBoard from "../components/GranterFinanceBoard";
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

function granterStatusLabel(status?: string): string {
  if (status === "success") return "연결 가능";
  if (status === "config_required") return "설정 필요";
  if (status === "failed") return "확인 필요";
  if (status === "skipped") return "대기";
  return "준비 전";
}

function granterStatusTone(status?: string): string {
  if (status === "success") return "green";
  if (status === "config_required") return "amber";
  if (status === "failed") return "red";
  return "gray";
}

export default function Sales() {
  const {
    salesOrders, salesSyncRuns, salesDailySummaries, granterSyncRuns,
    granterCardSales, granterAccountTransactions, granterFinanceCategories,
    syncSales, syncGranterFinance, classifyGranterFinanceItems,
    upsertGranterFinanceCategory, deleteGranterFinanceCategory,
    mode, role, showToast,
  } = useStore();
  const [date, setDate] = useState(TODAY_STR);
  /*
    **POS 매출과 카드·계좌는 다른 숫자다.** 카드 승인액에는 현금이 안 들어가고,
    POS 매출에는 아직 정산 안 된 것도 들어간다. 한 화면에 섞어 두면 어느 쪽이
    «오늘 얼마 팔았나»인지 알 수 없다 — 그래서 탭으로 가른다.
  */
  const [tab, setTab] = useState<"pos" | "finance">("pos");
  const [syncing, setSyncing] = useState(false);
  const [granterSyncing, setGranterSyncing] = useState(false);
  const orders = useMemo(() => ordersForDate(salesOrders, date), [salesOrders, date]);
  const summary = useMemo(() => salesSummary(orders), [orders]);
  const payments = useMemo(() => paymentTotals(orders), [orders]);
  const hourly = useMemo(() => hourlySales(orders), [orders]);
  const menus = useMemo(() => menuSales(orders), [orders]);
  const latestRun = latestSyncRun(salesSyncRuns);
  const latestGranterRun = granterSyncRuns[0];

  const runSync = async () => {
    setSyncing(true);
    try {
      await syncSales();
    } catch (e) {
      showToast((e as Error).message || "매출 동기화에 실패했습니다");
    } finally {
      setSyncing(false);
    }
  };

  const runGranterSync = async () => {
    setGranterSyncing(true);
    try {
      await syncGranterFinance();
    } catch (e) {
      showToast((e as Error).message || "카드·계좌 동기화에 실패했습니다");
    } finally {
      setGranterSyncing(false);
    }
  };

  /*
    **오늘(선택일) 합계는 저장된 것을 그대로 쓴다.** 주문에서 계산하지 않는다 —
    지금 매출 정본인 네이버 플레이스플러스는 일 합계만 주고 주문을 안 준다.
  */
  const daily = salesDailySummaries.find((row) => row.businessDate === date) ?? null;
  /** 주문이 하나도 없으면 원장·시간대별·메뉴별은 그릴 것이 없다. */
  const hasOrders = orders.length > 0;

  return (
    <>
      <div className="finance-tabs" role="tablist" aria-label="매출 보기">
        <button className={tab === "pos" ? "on" : ""} onClick={() => setTab("pos")}>
          <span>🧾</span>POS 매출
        </button>
        <button className={tab === "finance" ? "on" : ""} onClick={() => setTab("finance")}>
          <span>💳</span>카드·계좌
        </button>
      </div>

      {tab === "pos" ? (
      <>
      <div className="grid grid-4">
        {/*
          **주문이 있으면 주문에서, 없으면 저장된 합계에서 읽는다.**

          네이버 플레이스플러스는 일 합계만 준다. 그런데 화면은 원래 주문을 다 받아
          스스로 합치게 만들어져 있어서, 주문이 없으면 **0원**을 그렸다 — 매출이 든
          날에도 그랬다.
        */}
        <StatCard
          label="선택일 매출"
          value={money(hasOrders ? summary.netAmount : daily?.netAmount ?? 0)}
          unit="원"
          /*
            **모르는 건수를 «0건»이라 적지 않는다.** 네이버는 건수를 안 준다.
            0 이라고 쓰면 사람은 그것을 사실로 믿는다.
          */
          trend={hasOrders
            ? `${summary.orderCount}건`
            : daily?.hasOrderCount ? `${daily.orderCount}건` : "건수 없음"}
          trendUp
          icon="💳"
        />
        <StatCard label="객단가" value={money(hasOrders ? summary.averageOrderAmount : 0)} unit="원" trend={hasOrders ? "결제완료 기준" : "주문 자료 없음"} trendUp icon="🧾" tone="blue" />
        <StatCard label="취소/환불" value={money(hasOrders ? summary.refundAmount : 0)} unit="원" trend={hasOrders ? `${summary.canceledCount}건` : "주문 자료 없음"} trendUp={false} icon="↩️" tone="amber" />
        <StatCard label="할인" value={money(hasOrders ? summary.discountAmount : 0)} unit="원" trend={hasOrders ? "POS 원장 기준" : "주문 자료 없음"} trendUp={false} icon="🏷️" />
      </div>

      <Card
        title="매출 동기화"
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
              {latestRun?.message ?? (mode === "demo" ? "데모 모드에서는 샘플 매출을 보여줍니다." : "네이버 플레이스플러스 매출을 오너비스타에서 매일 받아 옵니다.")}
            </div>
          </div>
        </div>
      </Card>


      {/* 주문이 없으면 원장·시간대별·메뉴별은 그릴 것이 없다. 빈 표는 없는 것보다 나쁘다. */}
      {hasOrders ? (
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
      ) : null}

      </>
      ) : (
      <>
      <Card
        title="그랜터 카드·계좌 연동"
        icon="🏦"
        action={
          <button className="btn btn-primary btn-sm" disabled={granterSyncing} onClick={() => void runGranterSync()}>
            {granterSyncing ? "동기화 중..." : "카드·계좌 동기화"}
          </button>
        }
      >
        <div className="integration-status-grid">
          <div className="integration-status-card">
            <span className="muted small">현재 상태</span>
            <Badge tone={granterStatusTone(latestGranterRun?.status)}>{granterStatusLabel(latestGranterRun?.status)}</Badge>
            <strong>{latestGranterRun?.message ?? "그랜터 카드·계좌 API 연결 대기 중입니다."}</strong>
          </div>
          <div className="integration-status-card">
            <span className="muted small">최근 동기화</span>
            <strong>{latestGranterRun?.finishedAt || latestGranterRun?.startedAt || "아직 없음"}</strong>
            <span className="muted small">
              카드 신규 {latestGranterRun?.cardImportedCount ?? 0}건 · 갱신 {latestGranterRun?.cardUpdatedCount ?? 0}건
              <br />
              계좌 신규 {latestGranterRun?.accountImportedCount ?? 0}건 · 갱신 {latestGranterRun?.accountUpdatedCount ?? 0}건
            </span>
          </div>
          <div className="integration-status-card">
            <span className="muted small">연동 목표</span>
            <strong>카드 승인·정산과 계좌 입출금만 수집</strong>
            <span className="muted small">세금계산서·급여·발주 데이터는 가져오지 않습니다.</span>
          </div>
        </div>
      </Card>
      <GranterFinanceBoard
        role={role}
        cardItems={granterCardSales}
        accountItems={granterAccountTransactions}
        categories={granterFinanceCategories}
        classifyItems={classifyGranterFinanceItems}
        upsertCategory={upsertGranterFinanceCategory}
        deleteCategory={deleteGranterFinanceCategory}
      />

      </>
      )}
    </>
  );
}
