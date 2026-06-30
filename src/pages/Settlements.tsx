import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Badge, Card, StatCard } from "../components/ui";
import type { PurchaseOrder, PurchaseOrderStatus, SettlementMethod } from "../data/types";
import { TODAY_STR } from "../lib/time";

type SettlementFilter = "all" | "unsettled" | "settled";

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

function orderBaseDate(order: PurchaseOrder): string {
  return (order.receivedAt || order.orderedAt || order.createdAt || "").slice(0, 10);
}

function isSettled(order: PurchaseOrder): boolean {
  return order.settlementStatus === "settled";
}

function sumAmount(orders: PurchaseOrder[]): number {
  return orders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
}

function methodLabel(method?: SettlementMethod): string {
  return method ? METHOD_LABEL[method] : "-";
}

interface SettlementDraft {
  settledAt: string;
  settlementMethod: SettlementMethod;
  settlementMemo: string;
}

export default function Settlements() {
  const { vendors, purchaseOrders, upsertPurchaseOrder, showToast } = useStore();
  const [selectedMonth, setSelectedMonth] = useState(TODAY_STR.slice(0, 7));
  const [statusFilter, setStatusFilter] = useState<SettlementFilter>("unsettled");
  const [vendorFilter, setVendorFilter] = useState<number | "all">("all");
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<number, SettlementDraft>>({});

  const activeOrders = useMemo(
    () => purchaseOrders.filter((order) => order.status !== "canceled"),
    [purchaseOrders]
  );

  const monthOrders = useMemo(
    () => activeOrders.filter((order) => orderBaseDate(order).startsWith(selectedMonth)),
    [activeOrders, selectedMonth]
  );

  const filteredOrders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return monthOrders
      .filter((order) => {
        if (statusFilter === "settled") return isSettled(order);
        if (statusFilter === "unsettled") return !isSettled(order);
        return true;
      })
      .filter((order) => vendorFilter === "all" || order.vendorId === vendorFilter)
      .filter((order) =>
        !q || [
          order.vendorName,
          order.memo,
          order.settlementMemo,
          String(order.id),
          ...order.items.map((item) => item.name),
        ].filter(Boolean).some((value) => String(value).toLowerCase().includes(q))
      )
      .sort((a, b) => orderBaseDate(b).localeCompare(orderBaseDate(a)) || b.id - a.id);
  }, [monthOrders, query, statusFilter, vendorFilter]);

  const settledOrders = monthOrders.filter(isSettled);
  const unsettledOrders = monthOrders.filter((order) => !isSettled(order));
  const receivedUnsettledOrders = unsettledOrders.filter((order) => order.status === "received");

  const vendorRows = useMemo(() => {
    const map = new Map<number, {
      vendorId: number;
      vendorName: string;
      account: string;
      totalAmount: number;
      settledAmount: number;
      unsettledAmount: number;
      count: number;
      unsettledCount: number;
    }>();

    monthOrders.forEach((order) => {
      const vendor = vendors.find((item) => item.id === order.vendorId);
      const current = map.get(order.vendorId) ?? {
        vendorId: order.vendorId,
        vendorName: order.vendorName || vendor?.name || `거래처 ${order.vendorId}`,
        account: vendor?.bank || vendor?.account ? `${vendor?.bank ?? ""} ${vendor?.account ?? ""}`.trim() : "-",
        totalAmount: 0,
        settledAmount: 0,
        unsettledAmount: 0,
        count: 0,
        unsettledCount: 0,
      };
      current.totalAmount += Number(order.totalAmount || 0);
      current.count += 1;
      if (isSettled(order)) {
        current.settledAmount += Number(order.totalAmount || 0);
      } else {
        current.unsettledAmount += Number(order.totalAmount || 0);
        current.unsettledCount += 1;
      }
      map.set(order.vendorId, current);
    });

    return [...map.values()].sort((a, b) => b.unsettledAmount - a.unsettledAmount || a.vendorName.localeCompare(b.vendorName));
  }, [monthOrders, vendors]);

  const draftFor = (order: PurchaseOrder): SettlementDraft => drafts[order.id] ?? {
    settledAt: order.settledAt || TODAY_STR,
    settlementMethod: order.settlementMethod ?? "bank",
    settlementMemo: order.settlementMemo ?? "",
  };

  const updateDraft = <K extends keyof SettlementDraft>(orderId: number, key: K, value: SettlementDraft[K]) => {
    setDrafts((prev) => ({
      ...prev,
      [orderId]: {
        ...(prev[orderId] ?? { settledAt: TODAY_STR, settlementMethod: "bank", settlementMemo: "" }),
        [key]: value,
      },
    }));
  };

  const markSettled = (order: PurchaseOrder) => {
    const draft = draftFor(order);
    upsertPurchaseOrder({
      ...order,
      settlementStatus: "settled",
      settledAt: draft.settledAt || TODAY_STR,
      settlementMethod: draft.settlementMethod,
      settlementMemo: draft.settlementMemo.trim(),
    });
    showToast(`${order.vendorName} 발주서 #${order.id} 정산완료`);
  };

  const markUnsettled = (order: PurchaseOrder) => {
    upsertPurchaseOrder({
      ...order,
      settlementStatus: "unsettled",
      settledAt: "",
      settlementMemo: draftFor(order).settlementMemo.trim(),
    });
    showToast(`발주서 #${order.id}를 미정산으로 변경했습니다`);
  };

  const saveMemo = (order: PurchaseOrder) => {
    const draft = draftFor(order);
    upsertPurchaseOrder({
      ...order,
      settledAt: draft.settledAt,
      settlementMethod: draft.settlementMethod,
      settlementMemo: draft.settlementMemo.trim(),
    });
    showToast("정산 메모를 저장했습니다");
  };

  const copySummary = async () => {
    const lines = [
      `[하늘땅 ${selectedMonth} 정산 요약]`,
      `발주 등록액: ${money.format(sumAmount(monthOrders))}원`,
      `미정산: ${money.format(sumAmount(unsettledOrders))}원`,
      `정산완료: ${money.format(sumAmount(settledOrders))}원`,
      "",
      ...vendorRows.map((row) =>
        `- ${row.vendorName}: 미정산 ${money.format(row.unsettledAmount)}원 / 총 ${money.format(row.totalAmount)}원 (${row.unsettledCount}/${row.count}건)`
      ),
    ];
    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      showToast("정산 요약을 복사했습니다");
    } catch {
      window.prompt("복사할 정산 요약입니다", text);
    }
  };

  return (
    <div className="stack settlement-page">
      <div className="grid grid-4">
        <StatCard label={`${selectedMonth} 발주 등록액`} value={Math.round(sumAmount(monthOrders) / 10000).toLocaleString()} unit="만원" trend={`${monthOrders.length}건`} trendUp icon="🧾" />
        <StatCard label="미정산 금액" value={Math.round(sumAmount(unsettledOrders) / 10000).toLocaleString()} unit="만원" trend={`${unsettledOrders.length}건`} trendUp={unsettledOrders.length === 0} icon="⚠️" tone="amber" />
        <StatCard label="입고 후 미정산" value={Math.round(sumAmount(receivedUnsettledOrders) / 10000).toLocaleString()} unit="만원" trend={`${receivedUnsettledOrders.length}건`} trendUp={receivedUnsettledOrders.length === 0} icon="📦" tone="red" />
        <StatCard label="정산완료" value={Math.round(sumAmount(settledOrders) / 10000).toLocaleString()} unit="만원" trend={`${settledOrders.length}건`} trendUp icon="✅" tone="blue" />
      </div>

      <Card
        title="정산 필터"
        icon="🔎"
        action={<button className="btn btn-outline btn-sm" onClick={copySummary}>요약 복사</button>}
      >
        <div className="settlement-filter-row">
          <div>
            <label className="field-label">정산 월</label>
            <input className="input" type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} />
          </div>
          <div>
            <label className="field-label">거래처</label>
            <select className="select" value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value === "all" ? "all" : Number(e.target.value))}>
              <option value="all">전체 거래처</option>
              {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">상태</label>
            <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as SettlementFilter)}>
              <option value="unsettled">미정산</option>
              <option value="settled">정산완료</option>
              <option value="all">전체</option>
            </select>
          </div>
          <div>
            <label className="field-label">검색</label>
            <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="거래처, 품목, 발주번호" />
          </div>
        </div>
      </Card>

      <Card title="거래처별 정산 요약" icon="🏢">
        <div className="settlement-vendor-grid">
          {vendorRows.map((row) => (
            <button
              className={`settlement-vendor-card ${vendorFilter === row.vendorId ? "on" : ""}`}
              key={row.vendorId}
              onClick={() => setVendorFilter(vendorFilter === row.vendorId ? "all" : row.vendorId)}
            >
              <div className="spread">
                <strong>{row.vendorName}</strong>
                <Badge tone={row.unsettledAmount > 0 ? "amber" : "green"}>
                  {row.unsettledAmount > 0 ? "미정산" : "완료"}
                </Badge>
              </div>
              <div className="settlement-vendor-amount">{money.format(row.unsettledAmount)}원</div>
              <div className="muted small">총 {money.format(row.totalAmount)}원 · {row.unsettledCount}/{row.count}건 미정산</div>
              <div className="muted small">계좌 {row.account}</div>
            </button>
          ))}
          {vendorRows.length === 0 && (
            <div className="empty-state">선택한 월에 등록된 발주서가 없습니다.</div>
          )}
        </div>
      </Card>

      <Card title="발주서 정산 목록" icon="🧾">
        <div className="table-wrap">
          <table className="table settlement-table">
            <thead>
              <tr>
                <th>발주</th>
                <th>거래처</th>
                <th>입고/발주상태</th>
                <th>품목</th>
                <th>금액</th>
                <th>정산상태</th>
                <th>정산일</th>
                <th>결제수단</th>
                <th>메모</th>
                <th>처리</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => {
                const draft = draftFor(order);
                const settled = isSettled(order);
                return (
                  <tr key={order.id}>
                    <td>
                      <div className="bold">#{order.id}</div>
                      <div className="muted small">{orderBaseDate(order) || "-"}</div>
                    </td>
                    <td className="bold">{order.vendorName}</td>
                    <td><Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Badge></td>
                    <td>
                      <div className="settlement-items">
                        {order.items.slice(0, 3).map((item) => (
                          <span key={item.inventoryItemId}>{item.name} {item.qty}{item.unit}</span>
                        ))}
                        {order.items.length > 3 && <span>외 {order.items.length - 3}개</span>}
                      </div>
                    </td>
                    <td className="num bold">{money.format(order.totalAmount)}원</td>
                    <td>{settled ? <Badge tone="green">정산완료</Badge> : <Badge tone="amber">미정산</Badge>}</td>
                    <td>
                      <input
                        className="input"
                        type="date"
                        value={draft.settledAt}
                        onChange={(e) => updateDraft(order.id, "settledAt", e.target.value)}
                      />
                    </td>
                    <td>
                      <select
                        className="select"
                        value={draft.settlementMethod}
                        onChange={(e) => updateDraft(order.id, "settlementMethod", e.target.value as SettlementMethod)}
                      >
                        {Object.entries(METHOD_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="input"
                        value={draft.settlementMemo}
                        onChange={(e) => updateDraft(order.id, "settlementMemo", e.target.value)}
                        placeholder="메모"
                      />
                      {settled && (
                        <div className="muted small">
                          {order.settledAt || "-"} · {methodLabel(order.settlementMethod)}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="settlement-actions">
                        {settled ? (
                          <button className="btn btn-outline btn-sm" onClick={() => markUnsettled(order)}>미정산</button>
                        ) : (
                          <button className="btn btn-primary btn-sm" onClick={() => markSettled(order)}>정산완료</button>
                        )}
                        <button className="btn btn-outline btn-sm" onClick={() => saveMemo(order)}>메모저장</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={10} className="muted" style={{ textAlign: "center", padding: 24 }}>
                    조건에 맞는 발주서가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
