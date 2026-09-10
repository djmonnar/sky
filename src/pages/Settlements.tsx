import { useEffect, useMemo, useState, type DragEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useStore } from "../store";
import { Badge, Card, StatCard } from "../components/ui";
import PosSalesBoard from "../components/PosSalesBoard";
import type {
  FinanceDailyClose,
  PurchaseOrder,
  PurchaseOrderStatus,
  SettlementMethod,
} from "../data/types";
import { TODAY_STR } from "../lib/time";

type FinanceTab = "close" | "pos" | "purchases" | "profit";
type SettlementFilter = "all" | "unsettled" | "settled";

/*
  **POS 매출이 첫 탭이다.** 매출·매입에 들어와서 제일 먼저 봐야 할 숫자다.

  「매출」(카드 승인·정산)과 「입출금 매칭」 탭은 뺐다. 둘 다 그랜터가 준 카드·계좌
  거래로만 돌아가는데, 동기화가 너무 오래 걸려 그랜터를 보류하기로 했다. 남겨 두면
  0원과 빈 목록만 보인다. 데이터·규칙·함수와 GranterFinanceBoard 파일은 그대로
  두었으니 다시 켤 때 이 배열과 렌더 두 곳만 되돌리면 된다.
*/
const TABS: Array<{ id: FinanceTab; label: string; icon: string }> = [
  { id: "pos", label: "POS 매출", icon: "🧾" },
  { id: "close", label: "오늘 마감", icon: "✓" },
  { id: "purchases", label: "매입", icon: "🧾" },
  { id: "profit", label: "손익", icon: "📊" },
];

const ORDER_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: "작성중",
  ordered: "발주완료",
  received: "입고완료",
  canceled: "취소",
};

const ORDER_STATUS_TONE: Record<PurchaseOrderStatus, string> = {
  draft: "amber",
  ordered: "blue",
  received: "green",
  canceled: "red",
};

const METHOD_LABEL: Record<SettlementMethod, string> = {
  bank: "계좌이체",
  cash: "현금",
  card: "카드",
  other: "기타",
};

const money = new Intl.NumberFormat("ko-KR");

function amount(value: number): string {
  return `${money.format(Math.round(value))}원`;
}

function orderBaseDate(order: PurchaseOrder): string {
  return (order.receivedAt || order.orderedAt || order.createdAt || "").slice(0, 10);
}





function sumOrders(orders: PurchaseOrder[]): number {
  return orders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
}


interface SettlementDraft {
  settledAt: string;
  settlementMethod: SettlementMethod;
  settlementMemo: string;
}

interface CloseDraft {
  cashSales: string;
  transferSales: string;
  otherSales: string;
  memo: string;
}

function createMatchId(): string {
  return `finance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function Settlements() {
  const {
    role, profile, authUser, managerPermissions, vendors, purchaseOrders, payroll,
    salesDailySummaries, salesMenuReport, syncSales,
    financeDailyCloses,
    upsertPurchaseOrder,
    upsertFinanceDailyClose, showToast,
  } = useStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab") as FinanceTab | null;
  const [activeTab, setActiveTab] = useState<FinanceTab>(TABS.some((tab) => tab.id === requestedTab) ? requestedTab! : "pos");
  const [date, setDate] = useState(TODAY_STR);
  const [month, setMonth] = useState(TODAY_STR.slice(0, 7));
  const [closeDraft, setCloseDraft] = useState<CloseDraft>({ cashSales: "", transferSales: "", otherSales: "", memo: "" });
  const [statusFilter, setStatusFilter] = useState<SettlementFilter>("unsettled");
  const [vendorFilter, setVendorFilter] = useState<number | "all">("all");
  const [query, setQuery] = useState("");
  const [settlementDrafts, setSettlementDrafts] = useState<Record<number, SettlementDraft>>({});
  const canViewSales = role === "admin" || managerPermissions.sales;
  const canViewPurchases = role === "admin" || managerPermissions.settlements;
  const visibleTabs = useMemo(() => TABS.filter((tab) => {
    if (tab.id === "close") return canViewSales;
    if (tab.id === "purchases") return canViewPurchases;
    // POS 매출과 손익은 관리자만 본다.
    return role === "admin";
  }), [canViewPurchases, canViewSales, role]);

  useEffect(() => {
    if (visibleTabs.some((tab) => tab.id === activeTab)) return;
    // 볼 수 있는 첫 탭으로 보낸다. 없어진 탭 이름을 적으면 이 효과가 무한히 돈다.
    const fallback = visibleTabs[0]?.id;
    if (!fallback || fallback === activeTab) return;
    setActiveTab(fallback);
    setSearchParams(fallback === "pos" ? {} : { tab: fallback });
  }, [activeTab, setSearchParams, visibleTabs]);

  const [posSyncing, setPosSyncing] = useState(false);
  // POS 매출은 저장된 일 합계를 그대로 읽는다 — 집계·달력은 PosSalesBoard 가 맡는다.

  const runPosSync = async () => {
    setPosSyncing(true);
    try {
      await syncSales();
    } catch (error) {
      showToast((error as Error).message || "POS 매출 동기화에 실패했습니다");
    } finally {
      setPosSyncing(false);
    }
  };

  const openTab = (tab: FinanceTab) => {
    setActiveTab(tab);
    setSearchParams(tab === "pos" ? {} : { tab });
  };

  const activeOrders = useMemo(
    () => purchaseOrders.filter((order) => order.status !== "canceled"),
    [purchaseOrders]
  );
  const selectedClose = financeDailyCloses.find((item) => item.date === date);

  useEffect(() => {
    setCloseDraft({
      cashSales: selectedClose?.cashSales ? String(selectedClose.cashSales) : "",
      transferSales: selectedClose?.transferSales ? String(selectedClose.transferSales) : "",
      otherSales: selectedClose?.otherSales ? String(selectedClose.otherSales) : "",
      memo: selectedClose?.memo ?? "",
    });
  }, [date, selectedClose?.cashSales, selectedClose?.transferSales, selectedClose?.otherSales, selectedClose?.memo]);

  /*
    카드 매출은 그랜터가 채우던 칸이라 지금은 비어 있다. 대신 이 매장의 매출 정본인
    POS 일 매출(네이버 플레이스플러스)을 참고로 보여 준다. 마감 합계에는 더하지 않는다 —
    POS 에 이미 카드·현금이 섞여 있어 직접 입력분과 겹칠 수 있다.
  */
  const dayPos = salesDailySummaries.find((row) => row.businessDate === date);
  const dayOrders = activeOrders.filter((order) => orderBaseDate(order) === date);
  const dayPurchases = sumOrders(dayOrders);
  const manualSales = Number(closeDraft.cashSales || 0) + Number(closeDraft.transferSales || 0) + Number(closeDraft.otherSales || 0);
  const totalDaySales = manualSales;

  const receivedUnpaid = dayOrders.filter((order) => order.status === "received" && order.settlementStatus !== "settled");

  const saveClose = async (status: FinanceDailyClose["status"]) => {
    const next: FinanceDailyClose = {
      id: date,
      date,
      cashSales: Number(closeDraft.cashSales || 0),
      transferSales: Number(closeDraft.transferSales || 0),
      otherSales: Number(closeDraft.otherSales || 0),
      memo: closeDraft.memo,
      status,
      closedAt: status === "closed" ? new Date().toISOString() : "",
      closedBy: status === "closed" ? profile?.name || authUser?.email || "관리자" : "",
      createdAt: selectedClose?.createdAt,
    };
    await upsertFinanceDailyClose(next);
  };

  const monthOrders = activeOrders.filter((order) => orderBaseDate(order).startsWith(month));
  const settledOrders = monthOrders.filter((order) => order.settlementStatus === "settled");
  const unsettledOrders = monthOrders.filter((order) => order.settlementStatus !== "settled");
  const filteredOrders = monthOrders
    .filter((order) => statusFilter === "all" || (statusFilter === "settled") === (order.settlementStatus === "settled"))
    .filter((order) => vendorFilter === "all" || order.vendorId === vendorFilter)
    .filter((order) => {
      const needle = query.trim().toLowerCase();
      return !needle || [order.vendorName, order.memo, order.settlementMemo, String(order.id), ...order.items.map((item) => item.name)]
        .filter(Boolean).some((value) => String(value).toLowerCase().includes(needle));
    })
    .sort((a, b) => orderBaseDate(b).localeCompare(orderBaseDate(a)) || b.id - a.id);

  const settlementDraftFor = (order: PurchaseOrder): SettlementDraft => settlementDrafts[order.id] ?? {
    settledAt: order.settledAt || TODAY_STR,
    settlementMethod: order.settlementMethod ?? "bank",
    settlementMemo: order.settlementMemo ?? "",
  };

  const updateSettlementDraft = <K extends keyof SettlementDraft>(orderId: number, key: K, value: SettlementDraft[K]) => {
    setSettlementDrafts((current) => ({
      ...current,
      [orderId]: { ...(current[orderId] ?? { settledAt: TODAY_STR, settlementMethod: "bank", settlementMemo: "" }), [key]: value },
    }));
  };

  const saveSettlement = (order: PurchaseOrder, settled: boolean) => {
    const draft = settlementDraftFor(order);
    upsertPurchaseOrder({
      ...order,
      settlementStatus: settled ? "settled" : "unsettled",
      settledAt: settled ? draft.settledAt || TODAY_STR : "",
      settlementMethod: draft.settlementMethod,
      settlementMemo: draft.settlementMemo.trim(),
    });
    showToast(settled ? `${order.vendorName} 정산을 완료했습니다` : "미정산으로 변경했습니다");
  };



  /*
    총매출은 POS 일 매출(네이버 플레이스플러스) 합계다. 예전에는 그랜터 카드 승인액에
    직접 입력분을 더했는데, 그랜터를 보류하면서 카드가 통째로 빠져 손익이 크게 부풀
    수밖에 없다. POS 가 이 매장 매출의 정본이므로 그것을 쓴다.

    직접 입력 마감분(현금·계좌이체·기타)은 POS 와 겹칠 수 있어 더하지 않고 따로 보여 준다.
    고정·운영비는 그랜터 계좌 출금을 분류해 세던 값이라 지금은 셀 수 없다 — 0 으로
    슬쩍 넣으면 이익이 그만큼 부풀어 보이므로, 아예 빼고 그렇게 말한다.
  */
  const monthPos = salesDailySummaries
    .filter((row) => row.businessDate.startsWith(month))
    .reduce((sum, row) => sum + row.netAmount, 0);
  const monthPosDays = salesDailySummaries.filter((row) => row.businessDate.startsWith(month)).length;
  const monthManualSales = financeDailyCloses
    .filter((item) => item.date.startsWith(month))
    .reduce((sum, item) => sum + item.cashSales + item.transferSales + item.otherSales, 0);
  const monthPurchaseAmount = sumOrders(monthOrders);
  const monthPayroll = payroll
    .filter((row) => row.month ? row.month === month : month === TODAY_STR.slice(0, 7))
    .reduce((sum, row) => sum + Math.max(0, row.base + row.extra - row.deduct), 0);
  const monthSales = monthPos;
  const estimatedProfit = monthSales - monthPurchaseAmount - monthPayroll;

  return (
    <div className="stack finance-page">
      {/* 제목은 상단바가 이미 보여준다 — 여기서 한 번 더 적으면 모바일에서 한 화면을 잡아먹는다 */}
      <div className="finance-page-head">
        <p className="muted">POS 매출, 하루 마감, 발주와 결제를 한곳에서 확인합니다.</p>
      </div>

      <div className="finance-tabs" role="tablist" aria-label="매출 매입 관리 보기">
        {visibleTabs.map((tab) => (
          <button key={tab.id} className={activeTab === tab.id ? "on" : ""} onClick={() => openTab(tab.id)}>
            <span>{tab.icon}</span>{tab.label}
          </button>
        ))}
      </div>

      {activeTab === "close" && (
        <>
          <div className="finance-date-toolbar">
            <label><span className="field-label">마감일</span><input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
            <div className="finance-close-status">
              <Badge tone={selectedClose?.status === "closed" ? "green" : "amber"}>{selectedClose?.status === "closed" ? "마감 확정" : "마감 전"}</Badge>
              {selectedClose?.closedBy && <span className="muted small">{selectedClose.closedBy} · {selectedClose.closedAt?.slice(0, 16)}</span>}
            </div>
          </div>

          <div className="grid grid-3 finance-overview-stats">
            <StatCard
              label="POS 일 매출"
              value={dayPos ? money.format(dayPos.netAmount) : "-"}
              unit={dayPos ? "원" : ""}
              trend={dayPos ? "네이버 플레이스플러스" : "아직 안 들어옴"}
              trendUp={!!dayPos}
              icon="📈"
            />
            <StatCard label="직접 입력 매출" value={money.format(manualSales)} unit="원" trend="현금·계좌이체·기타" trendUp icon="✍️" tone="blue" />
            <StatCard label="오늘 등록 매입" value={money.format(dayPurchases)} unit="원" trend={`${dayOrders.length}건`} trendUp={dayPurchases === 0} icon="🧾" tone="amber" />
          </div>

          <div className="grid grid-main-side finance-close-grid">
            <Card title="마감 입력" icon="✓">
              <div className="finance-close-form">
                <label><span className="field-label">현금 매출</span><input className="input num" inputMode="numeric" value={closeDraft.cashSales} onChange={(event) => setCloseDraft((draft) => ({ ...draft, cashSales: event.target.value.replace(/[^0-9]/g, "") }))} placeholder="0" /></label>
                <label><span className="field-label">계좌이체 매출</span><input className="input num" inputMode="numeric" value={closeDraft.transferSales} onChange={(event) => setCloseDraft((draft) => ({ ...draft, transferSales: event.target.value.replace(/[^0-9]/g, "") }))} placeholder="0" /></label>
                <label><span className="field-label">기타 매출</span><input className="input num" inputMode="numeric" value={closeDraft.otherSales} onChange={(event) => setCloseDraft((draft) => ({ ...draft, otherSales: event.target.value.replace(/[^0-9]/g, "") }))} placeholder="0" /></label>
                <label className="finance-close-memo"><span className="field-label">마감 메모</span><textarea className="textarea" value={closeDraft.memo} onChange={(event) => setCloseDraft((draft) => ({ ...draft, memo: event.target.value }))} placeholder="현금 차이, 단체 결제, 확인할 내용을 적어주세요" /></label>
              </div>
              <div className="finance-close-total"><span>직접 입력 합계</span><strong>{amount(totalDaySales)}</strong></div>
              <div className="finance-close-actions">
                <button className="btn btn-outline" onClick={() => void saveClose("draft")}>임시 저장</button>
                {selectedClose?.status === "closed"
                  ? <button className="btn btn-outline" onClick={() => void saveClose("draft")}>마감 다시 열기</button>
                  : <button className="btn btn-primary" onClick={() => void saveClose("closed")}>마감 확정</button>}
              </div>
            </Card>

            <div className="stack">
              <Card title="확인할 일" icon="⚠️">
                <button className="finance-alert-row" onClick={() => openTab("purchases")}><span>입고 후 미정산</span><b>{receivedUnpaid.length}건</b></button>
                <div className="muted small" style={{ marginTop: 8 }}>
                  계좌 입출금 확인은 카드·계좌 연동을 다시 켤 때 돌아옵니다.
                </div>
              </Card>
            </div>
          </div>
        </>
      )}

      {activeTab === "pos" && (
        <PosSalesBoard
          summaries={salesDailySummaries}
          menuReport={salesMenuReport}
          syncing={posSyncing}
          onSync={() => void runPosSync()}
        />
      )}

      {activeTab === "purchases" && (
        <>
          <div className="grid grid-4">
            <StatCard label={`${month} 매입 등록액`} value={money.format(sumOrders(monthOrders))} unit="원" trend={`${monthOrders.length}건`} trendUp icon="🧾" />
            <StatCard label="미정산" value={money.format(sumOrders(unsettledOrders))} unit="원" trend={`${unsettledOrders.length}건`} trendUp={unsettledOrders.length === 0} icon="⚠️" tone="amber" />
            <StatCard label="입고 후 미정산" value={money.format(sumOrders(unsettledOrders.filter((order) => order.status === "received")))} unit="원" trend="확인 필요" trendUp={false} icon="📦" tone="red" />
            <StatCard label="정산완료" value={money.format(sumOrders(settledOrders))} unit="원" trend={`${settledOrders.length}건`} trendUp icon="✓" tone="blue" />
          </div>
          <Card title="매입 필터" icon="🔎">
            <div className="settlement-filter-row">
              <label><span className="field-label">매입 월</span><input className="input" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
              <label><span className="field-label">거래처</span><select className="select" value={vendorFilter} onChange={(event) => setVendorFilter(event.target.value === "all" ? "all" : Number(event.target.value))}><option value="all">전체 거래처</option>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></label>
              <label><span className="field-label">상태</span><select className="select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as SettlementFilter)}><option value="unsettled">미정산</option><option value="settled">정산완료</option><option value="all">전체</option></select></label>
              <label><span className="field-label">검색</span><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="거래처, 품목, 발주번호" /></label>
            </div>
          </Card>
          <Card title="발주·매입 목록" icon="🧾">
            <div className="table-wrap">
              <table className="table settlement-table finance-purchase-table">
                <thead><tr><th>발주</th><th>거래처/품목</th><th>금액</th><th>상태</th><th>정산일</th><th>수단</th><th>비고</th><th>처리</th></tr></thead>
                <tbody>
                  {filteredOrders.map((order) => {
                    const draft = settlementDraftFor(order);
                    const settled = order.settlementStatus === "settled";
                    return (
                      <tr key={order.id}>
                        <td><strong>#{order.id}</strong><div className="muted small">{orderBaseDate(order)}</div></td>
                        <td><strong>{order.vendorName}</strong><div className="settlement-items">{order.items.slice(0, 3).map((item) => <span key={`${order.id}-${item.inventoryItemId}`}>{item.name} {item.qty}{item.unit}</span>)}</div></td>
                        <td className="num bold">{amount(order.totalAmount)}</td>
                        <td><Badge tone={settled ? "green" : ORDER_STATUS_TONE[order.status]}>{settled ? "정산완료" : ORDER_STATUS_LABEL[order.status]}</Badge></td>
                        <td><input className="input" type="date" value={draft.settledAt} onChange={(event) => updateSettlementDraft(order.id, "settledAt", event.target.value)} /></td>
                        <td><select className="select" value={draft.settlementMethod} onChange={(event) => updateSettlementDraft(order.id, "settlementMethod", event.target.value as SettlementMethod)}>{Object.entries(METHOD_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                        <td><input className="input" value={draft.settlementMemo} onChange={(event) => updateSettlementDraft(order.id, "settlementMemo", event.target.value)} placeholder="비고" /></td>
                        <td><button className={`btn btn-sm ${settled ? "btn-outline" : "btn-primary"}`} onClick={() => saveSettlement(order, !settled)}>{settled ? "미정산 전환" : "정산완료"}</button></td>
                      </tr>
                    );
                  })}
                  {filteredOrders.length === 0 && <tr><td colSpan={8} className="empty-state">조건에 맞는 매입 내역이 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {activeTab === "profit" && (
        <>
          <Card title="월 손익 조회" icon="📅">
            <div className="finance-profit-toolbar"><label><span className="field-label">조회 월</span><input className="input" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><Badge tone="amber">추정 손익</Badge></div>
          </Card>
          <div className="grid grid-4">
            <StatCard label="총매출 (POS)" value={money.format(monthSales)} unit="원" trend={`${monthPosDays}일 집계`} trendUp icon="📈" />
            <StatCard label="식자재·매입" value={money.format(monthPurchaseAmount)} unit="원" trend={`${monthOrders.length}건`} trendUp={false} icon="🧾" tone="amber" />
            <StatCard label="인건비" value={money.format(monthPayroll)} unit="원" trend="급여 데이터 기준" trendUp={false} icon="👥" tone="blue" />
            <StatCard label="직접 입력 매출" value={money.format(monthManualSales)} unit="원" trend="총매출에 더하지 않음" trendUp icon="✍️" tone="blue" />
          </div>
          <Card title="예상 영업이익" icon="📊">
            <div className={`finance-profit-total ${estimatedProfit < 0 ? "negative" : ""}`}>
              <div><span>{month} 예상 영업이익</span><strong>{amount(estimatedProfit)}</strong></div>
              <div className="finance-profit-formula"><span>총매출 {amount(monthSales)}</span><span>− 매입 {amount(monthPurchaseAmount)}</span><span>− 인건비 {amount(monthPayroll)}</span></div>
            </div>
            <div className="finance-profit-note">
              총매출은 POS 일 매출(네이버 플레이스플러스) 합계입니다. 직접 입력 마감분은
              POS 와 겹칠 수 있어 더하지 않았습니다. <strong>고정·운영비(임대료·공과금 등)는
              빠져 있습니다</strong> — 계좌 출금을 분류해 세던 값인데 카드·계좌 연동을 보류해
              지금은 셀 수 없습니다. 카드 수수료와 부가세도 빠진 운영용 추정치입니다.
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
