import { useEffect, useMemo, useState, type DragEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useStore } from "../store";
import { Badge, Card, StatCard } from "../components/ui";
import GranterFinanceBoard from "../components/GranterFinanceBoard";
import PosSalesBoard from "../components/PosSalesBoard";
import type {
  FinanceDailyClose,
  FinanceMatch,
  FinanceMatchKind,
  GranterFinanceItem,
  PurchaseOrder,
  PurchaseOrderStatus,
  SettlementMethod,
} from "../data/types";
import { TODAY_STR } from "../lib/time";

type FinanceTab = "close" | "sales" | "pos" | "purchases" | "matching" | "profit";
type SettlementFilter = "all" | "unsettled" | "settled";

const TABS: Array<{ id: FinanceTab; label: string; icon: string }> = [
  { id: "close", label: "오늘 마감", icon: "✓" },
  { id: "sales", label: "매출", icon: "💳" },
  /*
    **POS 매출은 카드 매출과 다른 숫자다.** 「매출」 탭은 그랜터가 준 카드 승인·정산
    이라 현금이 안 들어 있고, POS 매출에는 아직 정산 안 된 것이 들어 있다. 한 탭에
    섞으면 어느 쪽이 「오늘 얼마 팔았나」인지 알 수 없다.
  */
  { id: "pos", label: "POS 매출", icon: "🧾" },
  { id: "purchases", label: "매입", icon: "🧾" },
  { id: "matching", label: "입출금 매칭", icon: "↔" },
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

function signedAmount(item: GranterFinanceItem): number {
  return item.direction === "out" ? -Math.abs(item.amount) : Math.abs(item.amount);
}

function isCardSale(item: GranterFinanceItem): boolean {
  return item.ticketType === "MERCHANT_CARD_TRANSACTION_TICKET";
}

function isCardSettlement(item: GranterFinanceItem): boolean {
  return item.ticketType === "MERCHANT_CARD_SETTLEMENT_DETAIL_TICKET";
}

function itemName(item: GranterFinanceItem): string {
  return item.content || item.contactName || item.description || (item.domain === "card" ? "카드 매출" : "계좌 거래");
}

function sumOrders(orders: PurchaseOrder[]): number {
  return orders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
}

function sumItems(items: GranterFinanceItem[]): number {
  return items.reduce((sum, item) => sum + Math.abs(item.amount), 0);
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
    granterCardSales, granterAccountTransactions, granterFinanceCategories,
    salesDailySummaries, syncSales,
    financeDailyCloses, financeMatches,
    upsertPurchaseOrder, syncGranterFinance, classifyGranterFinanceItems,
    upsertGranterFinanceCategory, deleteGranterFinanceCategory,
    upsertFinanceDailyClose, upsertFinanceMatch, deleteFinanceMatch, showToast,
  } = useStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab") as FinanceTab | null;
  const [activeTab, setActiveTab] = useState<FinanceTab>(TABS.some((tab) => tab.id === requestedTab) ? requestedTab! : "close");
  const [date, setDate] = useState(TODAY_STR);
  const [month, setMonth] = useState(TODAY_STR.slice(0, 7));
  const [syncing, setSyncing] = useState(false);
  const [closeDraft, setCloseDraft] = useState<CloseDraft>({ cashSales: "", transferSales: "", otherSales: "", memo: "" });
  const [statusFilter, setStatusFilter] = useState<SettlementFilter>("unsettled");
  const [vendorFilter, setVendorFilter] = useState<number | "all">("all");
  const [query, setQuery] = useState("");
  const [settlementDrafts, setSettlementDrafts] = useState<Record<number, SettlementDraft>>({});
  const [matchKind, setMatchKind] = useState<FinanceMatchKind>("purchasePayment");
  const [selectedOrders, setSelectedOrders] = useState<number[]>([]);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [matchMemo, setMatchMemo] = useState("");
  const [matching, setMatching] = useState(false);
  const canViewSales = role === "admin" || managerPermissions.sales;
  const canViewPurchases = role === "admin" || managerPermissions.settlements;
  const visibleTabs = useMemo(() => TABS.filter((tab) => {
    if (tab.id === "close" || tab.id === "sales") return canViewSales;
    if (tab.id === "purchases") return canViewPurchases;
    // POS 매출과 손익은 관리자만 본다.
    if (tab.id === "pos" || tab.id === "profit") return role === "admin";
    return canViewSales || canViewPurchases;
  }), [canViewPurchases, canViewSales, role]);

  useEffect(() => {
    if (visibleTabs.some((tab) => tab.id === activeTab)) return;
    const fallback = canViewSales ? "sales" : "purchases";
    setActiveTab(fallback);
    setSearchParams({ tab: fallback });
  }, [activeTab, canViewSales, setSearchParams, visibleTabs]);

  useEffect(() => {
    if (!canViewPurchases && matchKind === "purchasePayment") setMatchKind("salesDeposit");
    if (!canViewSales && matchKind === "salesDeposit") setMatchKind("purchasePayment");
  }, [canViewPurchases, canViewSales, matchKind]);

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
    setSearchParams(tab === "close" ? {} : { tab });
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

  const dayCardItems = granterCardSales.filter((item) => item.businessDate === date && isCardSale(item));
  const dayCardSales = dayCardItems.reduce((sum, item) => sum + signedAmount(item), 0);
  const dayAccountIn = granterAccountTransactions.filter((item) => item.businessDate === date && item.direction === "in");
  const dayAccountOut = granterAccountTransactions.filter((item) => item.businessDate === date && item.direction === "out");
  const dayOrders = activeOrders.filter((order) => orderBaseDate(order) === date);
  const dayPurchases = sumOrders(dayOrders);
  const manualSales = Number(closeDraft.cashSales || 0) + Number(closeDraft.transferSales || 0) + Number(closeDraft.otherSales || 0);
  const totalDaySales = dayCardSales + manualSales;

  const matchedOrderIds = useMemo(() => new Set(financeMatches.flatMap((match) => match.purchaseOrderIds)), [financeMatches]);
  const matchedCardIds = useMemo(() => new Set(financeMatches.flatMap((match) => match.cardItemIds)), [financeMatches]);
  const matchedAccountIds = useMemo(() => new Set(financeMatches.flatMap((match) => match.accountItemIds)), [financeMatches]);
  const receivedUnpaid = dayOrders.filter((order) => order.status === "received" && order.settlementStatus !== "settled");
  const unmatchedDayOutflows = dayAccountOut.filter((item) => !matchedAccountIds.has(item.id));

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

  const runSync = async () => {
    setSyncing(true);
    try {
      await syncGranterFinance();
    } catch (error) {
      showToast((error as Error).message || "카드·계좌 동기화에 실패했습니다");
    } finally {
      setSyncing(false);
    }
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

  const unmatchedOrders = activeOrders.filter((order) =>
    (order.status === "ordered" || order.status === "received") && !matchedOrderIds.has(order.id)
  );
  const unmatchedSettlements = granterCardSales.filter((item) => isCardSettlement(item) && !matchedCardIds.has(item.id));
  const availableAccounts = granterAccountTransactions.filter((item) =>
    item.direction === (matchKind === "purchasePayment" ? "out" : "in") && !matchedAccountIds.has(item.id)
  );
  const selectedOrderAmount = sumOrders(unmatchedOrders.filter((order) => selectedOrders.includes(order.id)));
  const selectedCardAmount = sumItems(unmatchedSettlements.filter((item) => selectedCards.includes(item.id)));
  const selectedAccountAmount = sumItems(availableAccounts.filter((item) => selectedAccounts.includes(item.id)));
  const selectedSourceAmount = matchKind === "purchasePayment" ? selectedOrderAmount : selectedCardAmount;

  const toggleNumber = (value: number, setter: React.Dispatch<React.SetStateAction<number[]>>) => {
    setter((items) => items.includes(value) ? items.filter((item) => item !== value) : [...items, value]);
  };
  const toggleString = (value: string, setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    setter((items) => items.includes(value) ? items.filter((item) => item !== value) : [...items, value]);
  };

  const clearMatchSelection = () => {
    setSelectedOrders([]);
    setSelectedCards([]);
    setSelectedAccounts([]);
    setMatchMemo("");
  };

  const changeMatchKind = (kind: FinanceMatchKind) => {
    setMatchKind(kind);
    clearMatchSelection();
  };

  const dragSource = (event: DragEvent<HTMLElement>, id: string | number) => {
    const ids = matchKind === "purchasePayment"
      ? (selectedOrders.includes(Number(id)) ? selectedOrders : [Number(id)])
      : (selectedCards.includes(String(id)) ? selectedCards : [String(id)]);
    if (matchKind === "purchasePayment") setSelectedOrders(ids as number[]);
    else setSelectedCards(ids as string[]);
    event.dataTransfer.setData("application/json", JSON.stringify({ kind: matchKind, ids }));
  };

  const dropOnAccount = (event: DragEvent<HTMLElement>, accountId: string) => {
    event.preventDefault();
    try {
      const payload = JSON.parse(event.dataTransfer.getData("application/json")) as { kind?: FinanceMatchKind; ids?: Array<string | number> };
      if (payload.kind !== matchKind || !payload.ids?.length) return;
      if (matchKind === "purchasePayment") setSelectedOrders(payload.ids.map(Number));
      else setSelectedCards(payload.ids.map(String));
      setSelectedAccounts((items) => items.includes(accountId) ? items : [...items, accountId]);
      showToast("양쪽 거래를 선택했습니다. 연결하기로 확정해주세요");
    } catch {
      showToast("거래를 선택하지 못했습니다");
    }
  };

  const createMatch = async () => {
    const sourceIds = matchKind === "purchasePayment" ? selectedOrders : selectedCards;
    if (sourceIds.length === 0 || selectedAccounts.length === 0) {
      showToast("왼쪽 증빙과 오른쪽 계좌 거래를 각각 선택해주세요");
      return;
    }
    setMatching(true);
    try {
      const next: FinanceMatch = {
        id: createMatchId(),
        kind: matchKind,
        purchaseOrderIds: matchKind === "purchasePayment" ? selectedOrders : [],
        cardItemIds: matchKind === "salesDeposit" ? selectedCards : [],
        accountItemIds: selectedAccounts,
        amount: Math.min(selectedSourceAmount, selectedAccountAmount),
        memo: matchMemo,
        createdAt: new Date().toISOString(),
        createdBy: profile?.name || authUser?.email || "관리자",
      };
      await upsertFinanceMatch(next);
      if (matchKind === "purchasePayment") {
        selectedOrders.forEach((orderId) => {
          const order = purchaseOrders.find((item) => item.id === orderId);
          if (!order) return;
          upsertPurchaseOrder({
            ...order,
            settlementStatus: "settled",
            settledAt: availableAccounts.find((item) => selectedAccounts.includes(item.id))?.businessDate || TODAY_STR,
            settlementMethod: "bank",
            settlementMemo: matchMemo || "계좌 출금 자동 연결",
          });
        });
      }
      clearMatchSelection();
    } finally {
      setMatching(false);
    }
  };

  const removeMatch = async (match: FinanceMatch) => {
    if (!window.confirm("이 연결을 해제할까요? 원본 거래와 발주서는 삭제되지 않습니다.")) return;
    await deleteFinanceMatch(match.id);
  };

  const monthCardSales = granterCardSales
    .filter((item) => item.businessDate.startsWith(month) && isCardSale(item))
    .reduce((sum, item) => sum + signedAmount(item), 0);
  const monthManualSales = financeDailyCloses
    .filter((item) => item.date.startsWith(month))
    .reduce((sum, item) => sum + item.cashSales + item.transferSales + item.otherSales, 0);
  const monthPurchaseAmount = sumOrders(monthOrders);
  const monthPayroll = payroll
    .filter((row) => row.month ? row.month === month : month === TODAY_STR.slice(0, 7))
    .reduce((sum, row) => sum + Math.max(0, row.base + row.extra - row.deduct), 0);
  const fixedCategoryIds = new Set(granterFinanceCategories.filter((category) => category.kind === "fixedExpense").map((category) => category.id));
  const monthFixedExpenses = granterAccountTransactions
    .filter((item) => item.businessDate.startsWith(month) && item.direction === "out" && item.categoryId && fixedCategoryIds.has(item.categoryId))
    .reduce((sum, item) => sum + Math.abs(item.amount), 0);
  const monthSales = monthCardSales + monthManualSales;
  const estimatedProfit = monthSales - monthPurchaseAmount - monthPayroll - monthFixedExpenses;

  return (
    <div className="stack finance-page">
      {/* 제목은 상단바가 이미 보여준다 — 여기서 한 번 더 적으면 모바일에서 한 화면을 잡아먹는다 */}
      <div className="finance-page-head">
        <p className="muted">카드 매출, 계좌 거래, 발주와 결제를 한곳에서 확인합니다.</p>
        {role === "admin" && <button className="btn btn-outline" disabled={syncing} onClick={() => void runSync()}>{syncing ? "동기화 중..." : "↻ 카드·계좌 동기화"}</button>}
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

          <div className="grid grid-4 finance-overview-stats">
            <StatCard label="카드사 매출" value={money.format(dayCardSales)} unit="원" trend={`${dayCardItems.length}건 · 자동`} trendUp icon="💳" />
            <StatCard label="직접 입력 매출" value={money.format(manualSales)} unit="원" trend="현금·계좌이체·기타" trendUp icon="✍️" tone="blue" />
            <StatCard label="오늘 총매출" value={money.format(totalDaySales)} unit="원" trend="카드 + 직접 입력" trendUp icon="📈" />
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
              <div className="finance-close-total"><span>마감 매출 합계</span><strong>{amount(totalDaySales)}</strong></div>
              <div className="finance-close-actions">
                <button className="btn btn-outline" onClick={() => void saveClose("draft")}>임시 저장</button>
                {selectedClose?.status === "closed"
                  ? <button className="btn btn-outline" onClick={() => void saveClose("draft")}>마감 다시 열기</button>
                  : <button className="btn btn-primary" onClick={() => void saveClose("closed")}>마감 확정</button>}
              </div>
            </Card>

            <div className="stack">
              <Card title="입출금 확인" icon="🏦">
                <div className="pay-line"><span className="k">계좌 입금</span><strong>{amount(sumItems(dayAccountIn))}</strong></div>
                <div className="pay-line"><span className="k">계좌 출금</span><strong>{amount(sumItems(dayAccountOut))}</strong></div>
                <div className="muted small">계좌 입금은 카드 정산금이나 기타 입금일 수 있어 총매출에 자동 합산하지 않습니다.</div>
              </Card>
              <Card title="확인할 일" icon="⚠️">
                <button className="finance-alert-row" onClick={() => openTab("purchases")}><span>입고 후 미정산</span><b>{receivedUnpaid.length}건</b></button>
                <button className="finance-alert-row" onClick={() => openTab("matching")}><span>연결 안 된 오늘 출금</span><b>{unmatchedDayOutflows.length}건</b></button>
                <button className="finance-alert-row" onClick={() => openTab("matching")}><span>연결 안 된 계좌 입금</span><b>{dayAccountIn.filter((item) => !matchedAccountIds.has(item.id)).length}건</b></button>
              </Card>
            </div>
          </div>
        </>
      )}

      {activeTab === "sales" && (
        <GranterFinanceBoard
          role={role}
          cardItems={granterCardSales}
          accountItems={granterAccountTransactions}
          categories={granterFinanceCategories}
          classifyItems={classifyGranterFinanceItems}
          upsertCategory={upsertGranterFinanceCategory}
          deleteCategory={deleteGranterFinanceCategory}
        />
      )}

      {activeTab === "pos" && (
        <PosSalesBoard
          summaries={salesDailySummaries}
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

      {activeTab === "matching" && (
        <>
          <Card title="증빙과 계좌 거래 연결" icon="↔">
            <div className="segmented finance-match-mode">
              {canViewPurchases && <button className={matchKind === "purchasePayment" ? "on" : ""} onClick={() => changeMatchKind("purchasePayment")}>매입 ↔ 계좌 출금</button>}
              {canViewSales && <button className={matchKind === "salesDeposit" ? "on" : ""} onClick={() => changeMatchKind("salesDeposit")}>카드 정산 ↔ 계좌 입금</button>}
            </div>
            <div className="finance-match-summary">
              <div><span>증빙 선택</span><strong>{amount(selectedSourceAmount)}</strong></div>
              <span className="finance-match-arrow">↔</span>
              <div><span>계좌 선택</span><strong>{amount(selectedAccountAmount)}</strong></div>
              <div className={selectedSourceAmount === selectedAccountAmount ? "match-ok" : "match-diff"}><span>차이</span><strong>{amount(Math.abs(selectedSourceAmount - selectedAccountAmount))}</strong></div>
            </div>
            <div className="finance-match-controls">
              <input className="input" value={matchMemo} onChange={(event) => setMatchMemo(event.target.value)} placeholder="연결 메모 (선택)" />
              <button className="btn btn-outline" onClick={clearMatchSelection}>선택 해제</button>
              <button className="btn btn-primary" disabled={matching} onClick={() => void createMatch()}>{matching ? "연결 중..." : "선택 거래 연결"}</button>
            </div>
          </Card>

          <div className="finance-match-board">
            <Card title={matchKind === "purchasePayment" ? "미연결 매입" : "미연결 카드 정산"} icon={matchKind === "purchasePayment" ? "🧾" : "💳"}>
              <div className="finance-match-list">
                {matchKind === "purchasePayment" ? unmatchedOrders.map((order) => (
                  <label key={order.id} className={`finance-match-item ${selectedOrders.includes(order.id) ? "selected" : ""}`} draggable onDragStart={(event) => dragSource(event, order.id)}>
                    <input type="checkbox" checked={selectedOrders.includes(order.id)} onChange={() => toggleNumber(order.id, setSelectedOrders)} />
                    <span><strong>{order.vendorName}</strong><small>#{order.id} · {orderBaseDate(order)} · {order.items.map((item) => item.name).slice(0, 2).join(", ")}</small></span>
                    <b>{amount(order.totalAmount)}</b>
                  </label>
                )) : unmatchedSettlements.map((item) => (
                  <label key={item.id} className={`finance-match-item ${selectedCards.includes(item.id) ? "selected" : ""}`} draggable onDragStart={(event) => dragSource(event, item.id)}>
                    <input type="checkbox" checked={selectedCards.includes(item.id)} onChange={() => toggleString(item.id, setSelectedCards)} />
                    <span><strong>{itemName(item)}</strong><small>{item.businessDate} · 카드 정산예정</small></span>
                    <b>{amount(Math.abs(item.amount))}</b>
                  </label>
                ))}
                {(matchKind === "purchasePayment" ? unmatchedOrders.length : unmatchedSettlements.length) === 0 && <div className="empty-state">연결할 증빙이 없습니다.</div>}
              </div>
            </Card>

            <Card title={matchKind === "purchasePayment" ? "미연결 계좌 출금" : "미연결 계좌 입금"} icon="🏦">
              <div className="finance-match-list">
                {availableAccounts.map((item) => (
                  <label key={item.id} className={`finance-match-item account ${selectedAccounts.includes(item.id) ? "selected" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropOnAccount(event, item.id)}>
                    <input type="checkbox" checked={selectedAccounts.includes(item.id)} onChange={() => toggleString(item.id, setSelectedAccounts)} />
                    <span><strong>{itemName(item)}</strong><small>{item.businessDate} {item.transactedAt.slice(11, 16)} · {item.categoryName || "미분류"}</small></span>
                    <b>{amount(Math.abs(item.amount))}</b>
                  </label>
                ))}
                {availableAccounts.length === 0 && <div className="empty-state">연결할 계좌 거래가 없습니다.</div>}
              </div>
            </Card>
          </div>

          <Card title="최근 연결 내역" icon="🔗">
            <div className="finance-match-history">
              {financeMatches.map((match) => (
                <div className="finance-match-history-row" key={match.id}>
                  <div><Badge tone={match.kind === "purchasePayment" ? "amber" : "green"}>{match.kind === "purchasePayment" ? "매입 결제" : "카드 정산"}</Badge><strong>{amount(match.amount)}</strong></div>
                  <div className="muted small">증빙 {match.kind === "purchasePayment" ? match.purchaseOrderIds.length : match.cardItemIds.length}건 · 계좌 {match.accountItemIds.length}건 · {match.createdAt.slice(0, 16)}</div>
                  <div>{match.memo && <span className="muted small">{match.memo}</span>}<button className="btn btn-outline btn-sm" onClick={() => void removeMatch(match)}>연결 해제</button></div>
                </div>
              ))}
              {financeMatches.length === 0 && <div className="empty-state">아직 연결한 거래가 없습니다.</div>}
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
            <StatCard label="총매출" value={money.format(monthSales)} unit="원" trend={`카드 ${amount(monthCardSales)}`} trendUp icon="📈" />
            <StatCard label="식자재·매입" value={money.format(monthPurchaseAmount)} unit="원" trend={`${monthOrders.length}건`} trendUp={false} icon="🧾" tone="amber" />
            <StatCard label="인건비" value={money.format(monthPayroll)} unit="원" trend="급여 데이터 기준" trendUp={false} icon="👥" tone="blue" />
            <StatCard label="고정·운영비" value={money.format(monthFixedExpenses)} unit="원" trend="분류된 계좌 출금" trendUp={false} icon="🏢" tone="amber" />
          </div>
          <Card title="예상 영업이익" icon="📊">
            <div className={`finance-profit-total ${estimatedProfit < 0 ? "negative" : ""}`}>
              <div><span>{month} 예상 영업이익</span><strong>{amount(estimatedProfit)}</strong></div>
              <div className="finance-profit-formula"><span>총매출 {amount(monthSales)}</span><span>− 매입 {amount(monthPurchaseAmount)}</span><span>− 인건비 {amount(monthPayroll)}</span><span>− 고정·운영비 {amount(monthFixedExpenses)}</span></div>
            </div>
            <div className="finance-profit-note">카드 수수료, 부가세와 아직 분류하지 않은 출금은 제외된 운영용 추정치입니다. 계좌 거래를 `고정·운영비` 용도로 분류할수록 정확해집니다.</div>
          </Card>
          <Card title="분류 점검" icon="🏷️">
            <div className="finance-category-audit">
              <div><strong>{granterAccountTransactions.filter((item) => item.businessDate.startsWith(month) && !item.categoryId).length}건</strong><span>이번 달 미분류 계좌 거래</span></div>
              <button className="btn btn-outline" onClick={() => openTab("sales")}>거래 분류하러 가기</button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
