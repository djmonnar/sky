import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Badge, Card, StatCard } from "../components/ui";
import type {
  InventoryCategory,
  InventoryItem,
  PurchaseOrder,
  PurchaseOrderStatus,
  StorageType,
  Vendor,
} from "../data/types";

const CATEGORIES: InventoryCategory[] = ["식재료", "주류", "음료", "소모품", "기타"];
const STORAGE_TYPES: StorageType[] = ["냉장", "냉동", "실온", "기타"];

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

const EMPTY_VENDOR: Vendor = {
  id: 0,
  name: "",
  businessNumber: "",
  address: "",
  contactName: "",
  phone: "",
  email: "",
  bank: "",
  account: "",
  memo: "",
  active: true,
};

const EMPTY_ITEM: InventoryItem = {
  id: 0,
  vendorId: 0,
  name: "",
  category: "식재료",
  storageType: "냉장",
  unit: "개",
  currentQty: 0,
  minQty: 0,
  defaultOrderQty: 0,
  unitPrice: 0,
  memo: "",
  active: true,
};

const money = new Intl.NumberFormat("ko-KR");

function nextVendorId(vendors: Vendor[]): number {
  return Math.max(0, ...vendors.map((vendor) => vendor.id)) + 1;
}

function nextInventoryItemId(items: InventoryItem[]): number {
  return Math.max(0, ...items.map((item) => item.id)) + 1;
}

function nextPurchaseOrderId(orders: PurchaseOrder[]): number {
  return Math.max(0, ...orders.map((order) => order.id)) + 1;
}

function needsOrder(item: InventoryItem): boolean {
  return Number(item.currentQty) <= Number(item.minQty);
}

function lineTotal(qty: number, unitPrice: number): number {
  return (Number(qty) || 0) * (Number(unitPrice) || 0);
}

function buildOrderText(order: PurchaseOrder): string {
  const lines = [
    "[하늘땅 발주서]",
    `거래처: ${order.vendorName}`,
    `발주번호: ${order.id}`,
    `작성일: ${order.createdAt.slice(0, 10)}`,
    "",
    ...order.items.map((item) =>
      `- ${item.name}: ${item.qty}${item.unit} x ${money.format(item.unitPrice)}원 = ${money.format(item.totalPrice)}원`
    ),
    "",
    `합계: ${money.format(order.totalAmount)}원`,
  ];
  if (order.memo) lines.push(`메모: ${order.memo}`);
  return lines.join("\n");
}

export default function Vendors() {
  const {
    vendors,
    upsertVendor,
    deleteVendor,
    inventoryItems,
    upsertInventoryItem,
    deleteInventoryItem,
    purchaseOrders,
    upsertPurchaseOrder,
    deletePurchaseOrder,
    receivePurchaseOrder,
    showToast,
  } = useStore();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Vendor>(EMPTY_VENDOR);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [itemDraft, setItemDraft] = useState<InventoryItem>(EMPTY_ITEM);
  const [itemEditingId, setItemEditingId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter((vendor) =>
      [vendor.name, vendor.businessNumber, vendor.address, vendor.contactName, vendor.phone]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [query, vendors]);

  const selectedVendor = useMemo(() => {
    return vendors.find((vendor) => vendor.id === openId) ?? filtered[0] ?? vendors[0] ?? null;
  }, [filtered, openId, vendors]);

  const selectedItems = useMemo(() => {
    if (!selectedVendor) return [];
    return inventoryItems
      .filter((item) => item.vendorId === selectedVendor.id && item.active !== false)
      .sort((a, b) => Number(needsOrder(b)) - Number(needsOrder(a)) || a.name.localeCompare(b.name));
  }, [inventoryItems, selectedVendor]);

  const selectedOrders = useMemo(() => {
    if (!selectedVendor) return [];
    return purchaseOrders.filter((order) => order.vendorId === selectedVendor.id);
  }, [purchaseOrders, selectedVendor]);

  const shortageItems = inventoryItems.filter((item) => item.active !== false && needsOrder(item));
  const draftOrders = purchaseOrders.filter((order) => order.status === "draft" || order.status === "ordered");
  const expectedOrderAmount = shortageItems.reduce((sum, item) => {
    const qty = Math.max(Number(item.defaultOrderQty) || 0, Number(item.minQty) - Number(item.currentQty), 1);
    return sum + qty * (Number(item.unitPrice) || 0);
  }, 0);

  const updateDraft = <K extends keyof Vendor>(key: K, value: Vendor[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const updateItemDraft = <K extends keyof InventoryItem>(key: K, value: InventoryItem[K]) => {
    setItemDraft((prev) => ({ ...prev, [key]: value }));
  };

  const resetForm = () => {
    setDraft(EMPTY_VENDOR);
    setEditingId(null);
  };

  const resetItemForm = () => {
    setItemDraft({ ...EMPTY_ITEM, vendorId: selectedVendor?.id ?? 0 });
    setItemEditingId(null);
  };

  const editVendor = (vendor: Vendor) => {
    setDraft({ ...vendor });
    setEditingId(vendor.id);
    setOpenId(vendor.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveVendor = () => {
    const name = draft.name.trim();
    const businessNumber = draft.businessNumber.trim();
    const address = draft.address.trim();
    if (!name) {
      showToast("거래처명을 입력해주세요");
      return;
    }
    if (!businessNumber) {
      showToast("사업자번호를 입력해주세요");
      return;
    }
    if (!address) {
      showToast("주소를 입력해주세요");
      return;
    }

    const id = editingId ?? nextVendorId(vendors);
    const vendor: Vendor = {
      ...draft,
      id,
      name,
      businessNumber,
      address,
      contactName: draft.contactName?.trim(),
      phone: draft.phone?.trim(),
      email: draft.email?.trim(),
      bank: draft.bank?.trim(),
      account: draft.account?.trim(),
      memo: draft.memo?.trim(),
      active: true,
      createdAt: draft.createdAt ?? new Date().toISOString(),
    };
    upsertVendor(vendor);
    setOpenId(id);
    showToast(editingId ? "거래처 정보를 수정했습니다" : "거래처를 등록했습니다");
    resetForm();
  };

  const removeVendor = (vendor: Vendor) => {
    if (!window.confirm(`${vendor.name} 거래처를 삭제할까요? 등록 품목과 발주서는 남아있습니다.`)) return;
    deleteVendor(vendor.id);
    if (editingId === vendor.id) resetForm();
    if (openId === vendor.id) setOpenId(null);
    showToast("거래처를 삭제했습니다");
  };

  const editItem = (item: InventoryItem) => {
    setItemDraft({ ...item });
    setItemEditingId(item.id);
  };

  const saveItem = () => {
    if (!selectedVendor) {
      showToast("먼저 거래처를 선택해주세요");
      return;
    }
    const name = itemDraft.name.trim();
    const unit = itemDraft.unit.trim();
    if (!name) {
      showToast("품목명을 입력해주세요");
      return;
    }
    if (!unit) {
      showToast("단위를 입력해주세요");
      return;
    }

    const item: InventoryItem = {
      ...itemDraft,
      id: itemEditingId ?? nextInventoryItemId(inventoryItems),
      vendorId: selectedVendor.id,
      name,
      unit,
      currentQty: Number(itemDraft.currentQty) || 0,
      minQty: Number(itemDraft.minQty) || 0,
      defaultOrderQty: Number(itemDraft.defaultOrderQty) || 0,
      unitPrice: Number(itemDraft.unitPrice) || 0,
      memo: itemDraft.memo?.trim(),
      active: true,
      createdAt: itemDraft.createdAt ?? new Date().toISOString(),
    };
    upsertInventoryItem(item);
    showToast(itemEditingId ? "발주 품목을 수정했습니다" : "발주 품목을 등록했습니다");
    resetItemForm();
  };

  const removeItem = (item: InventoryItem) => {
    if (!window.confirm(`${item.name} 품목을 삭제할까요?`)) return;
    deleteInventoryItem(item.id);
    if (itemEditingId === item.id) resetItemForm();
    showToast("발주 품목을 삭제했습니다");
  };

  const createOrder = (mode: "shortage" | "all") => {
    if (!selectedVendor) {
      showToast("먼저 거래처를 선택해주세요");
      return;
    }
    const sourceItems = mode === "shortage"
      ? selectedItems.filter(needsOrder)
      : selectedItems;
    if (sourceItems.length === 0) {
      showToast(mode === "shortage" ? "부족한 품목이 없습니다" : "등록된 품목이 없습니다");
      return;
    }

    const items = sourceItems.map((item) => {
      const shortageQty = Math.max(Number(item.minQty) - Number(item.currentQty), 0);
      const qty = Math.max(Number(item.defaultOrderQty) || 0, shortageQty, 1);
      return {
        inventoryItemId: item.id,
        name: item.name,
        qty,
        unit: item.unit,
        unitPrice: Number(item.unitPrice) || 0,
        totalPrice: lineTotal(qty, item.unitPrice),
      };
    });
    const order: PurchaseOrder = {
      id: nextPurchaseOrderId(purchaseOrders),
      vendorId: selectedVendor.id,
      vendorName: selectedVendor.name,
      status: "draft",
      items,
      totalAmount: items.reduce((sum, item) => sum + item.totalPrice, 0),
      createdAt: new Date().toISOString(),
      memo: mode === "shortage" ? "부족 품목 자동 발주" : "전체 품목 발주",
    };
    upsertPurchaseOrder(order);
    showToast("발주서를 만들었습니다");
  };

  const updateOrder = (order: PurchaseOrder, patch: Partial<PurchaseOrder>) => {
    upsertPurchaseOrder({ ...order, ...patch });
  };

  const updateOrderLine = (
    order: PurchaseOrder,
    inventoryItemId: number,
    patch: Partial<PurchaseOrder["items"][number]>
  ) => {
    const items = order.items.map((item) => {
      if (item.inventoryItemId !== inventoryItemId) return item;
      const next = { ...item, ...patch };
      const qty = Number(next.qty) || 0;
      const unitPrice = Number(next.unitPrice) || 0;
      return { ...next, qty, unitPrice, totalPrice: lineTotal(qty, unitPrice) };
    });
    upsertPurchaseOrder({
      ...order,
      items,
      totalAmount: items.reduce((sum, item) => sum + item.totalPrice, 0),
    });
  };

  const copyOrder = async (order: PurchaseOrder) => {
    const text = buildOrderText(order);
    try {
      await navigator.clipboard.writeText(text);
      showToast("발주서를 복사했습니다");
    } catch {
      window.prompt("복사할 발주서 내용입니다", text);
    }
  };

  const account = (vendor: Vendor) =>
    vendor.bank || vendor.account ? `${vendor.bank ?? ""} ${vendor.account ?? ""}`.trim() : "-";

  return (
    <>
      <div className="grid grid-4">
        <StatCard label="등록 거래처" value={vendors.length} unit="곳" trend="거래처 기준 발주" trendUp icon="🏢" />
        <StatCard label="발주 품목" value={inventoryItems.filter((item) => item.active !== false).length} unit="개" trend="재고 관리 중" trendUp icon="📦" tone="blue" />
        <StatCard label="발주 필요" value={shortageItems.length} unit="개" trend={`${money.format(expectedOrderAmount)}원 예상`} trendUp={false} icon="⚠️" tone="amber" />
        <StatCard label="진행 발주서" value={draftOrders.length} unit="건" trend="작성중/발주완료" trendUp icon="🧾" />
      </div>

      <Card
        title={editingId ? "거래처 수정" : "거래처 등록"}
        icon="🏢"
        action={editingId ? <button className="btn btn-outline btn-sm" onClick={resetForm}>새 거래처</button> : undefined}
      >
        <div className="grid grid-3" style={{ gap: 12 }}>
          <div>
            <label className="field-label">거래처명</label>
            <input className="input" value={draft.name} onChange={(e) => updateDraft("name", e.target.value)} placeholder="예: 하늘식자재" />
          </div>
          <div>
            <label className="field-label">사업자번호</label>
            <input className="input" value={draft.businessNumber} onChange={(e) => updateDraft("businessNumber", e.target.value)} placeholder="000-00-00000" />
          </div>
          <div>
            <label className="field-label">담당자</label>
            <input className="input" value={draft.contactName ?? ""} onChange={(e) => updateDraft("contactName", e.target.value)} placeholder="담당자명" />
          </div>
        </div>

        <div className="grid grid-3" style={{ gap: 12, marginTop: 14 }}>
          <div>
            <label className="field-label">연락처</label>
            <input className="input" value={draft.phone ?? ""} onChange={(e) => updateDraft("phone", e.target.value)} placeholder="010-0000-0000" />
          </div>
          <div>
            <label className="field-label">이메일</label>
            <input className="input" value={draft.email ?? ""} onChange={(e) => updateDraft("email", e.target.value)} placeholder="order@example.com" />
          </div>
          <div>
            <label className="field-label">은행/계좌</label>
            <div className="row" style={{ gap: 8 }}>
              <input className="input" value={draft.bank ?? ""} onChange={(e) => updateDraft("bank", e.target.value)} placeholder="은행" />
              <input className="input" value={draft.account ?? ""} onChange={(e) => updateDraft("account", e.target.value)} placeholder="계좌번호" />
            </div>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label className="field-label">주소</label>
          <input className="input" value={draft.address} onChange={(e) => updateDraft("address", e.target.value)} placeholder="거래처 주소" />
        </div>

        <div style={{ marginTop: 14 }}>
          <label className="field-label">메모</label>
          <textarea className="textarea" value={draft.memo ?? ""} onChange={(e) => updateDraft("memo", e.target.value)} placeholder="납품 품목, 주문 시간, 특이사항" />
        </div>

        <div className="row" style={{ justifyContent: "flex-end", marginTop: 16, flexWrap: "wrap" }}>
          <button className="btn btn-outline" onClick={resetForm}>취소</button>
          <button className="btn btn-primary" onClick={saveVendor}>{editingId ? "수정 저장" : "거래처 등록"}</button>
        </div>
      </Card>

      <Card
        title="거래처 목록"
        icon="📋"
        action={
          <input
            className="input"
            style={{ width: 240 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="거래처 검색"
          />
        }
      >
        <div className="table-wrap hide-mobile">
          <table className="table vendor-table">
            <thead>
              <tr>
                <th>거래처</th>
                <th>사업자번호</th>
                <th>주소</th>
                <th>담당자</th>
                <th>연락처</th>
                <th>품목</th>
                <th>발주 필요</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((vendor) => {
                const itemCount = inventoryItems.filter((item) => item.vendorId === vendor.id && item.active !== false).length;
                const shortageCount = inventoryItems.filter((item) => item.vendorId === vendor.id && item.active !== false && needsOrder(item)).length;
                return (
                  <tr
                    key={vendor.id}
                    className={selectedVendor?.id === vendor.id ? "sel" : ""}
                    onClick={() => setOpenId(openId === vendor.id ? null : vendor.id)}
                  >
                    <td className="bold">{vendor.name}</td>
                    <td className="num">{vendor.businessNumber}</td>
                    <td>{vendor.address}</td>
                    <td>{vendor.contactName || "-"}</td>
                    <td className="num">{vendor.phone || "-"}</td>
                    <td className="num">{itemCount}개</td>
                    <td>{shortageCount > 0 ? <Badge tone="amber">{shortageCount}개</Badge> : <Badge>정상</Badge>}</td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                        <button className="btn btn-outline btn-sm" onClick={() => editVendor(vendor)}>수정</button>
                        <button className="btn btn-danger btn-sm" onClick={() => removeVendor(vendor)}>삭제</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted" style={{ textAlign: "center", padding: 24 }}>
                    등록된 거래처가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="vendor-mobile-list hide-desktop">
          {filtered.map((vendor) => {
            const open = selectedVendor?.id === vendor.id;
            const itemCount = inventoryItems.filter((item) => item.vendorId === vendor.id && item.active !== false).length;
            const shortageCount = inventoryItems.filter((item) => item.vendorId === vendor.id && item.active !== false && needsOrder(item)).length;
            return (
              <div className={`vendor-card ${open ? "open" : ""}`} key={vendor.id}>
                <button className="vendor-card-head" onClick={() => setOpenId(open ? null : vendor.id)}>
                  <div>
                    <strong>{vendor.name}</strong>
                    <span>{vendor.businessNumber}</span>
                  </div>
                  <span className={`chev ${open ? "open" : ""}`}>›</span>
                </button>
                {open && (
                  <div className="vendor-card-body">
                    <div className="detail-line"><span className="k">주소</span><span className="v">{vendor.address || "-"}</span></div>
                    <div className="detail-line"><span className="k">담당자</span><span className="v">{vendor.contactName || "-"}</span></div>
                    <div className="detail-line"><span className="k">연락처</span><span className="v">{vendor.phone ? <a href={`tel:${vendor.phone}`}>{vendor.phone}</a> : "-"}</span></div>
                    <div className="detail-line"><span className="k">이메일</span><span className="v">{vendor.email ? <a href={`mailto:${vendor.email}`}>{vendor.email}</a> : "-"}</span></div>
                    <div className="detail-line"><span className="k">계좌</span><span className="v">{account(vendor)}</span></div>
                    <div className="detail-line"><span className="k">발주 품목</span><span className="v">{itemCount}개 · 부족 {shortageCount}개</span></div>
                    <div className="detail-line"><span className="k">메모</span><span className="v">{vendor.memo || "-"}</span></div>
                    <div className="vendor-card-actions">
                      <button className="btn btn-outline" onClick={() => editVendor(vendor)}>수정</button>
                      <button className="btn btn-danger" onClick={() => removeVendor(vendor)}>삭제</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="muted" style={{ textAlign: "center", padding: "20px 0" }}>
              등록된 거래처가 없습니다.
            </div>
          )}
        </div>
      </Card>

      <Card
        title={selectedVendor ? `${selectedVendor.name} 발주 관리` : "거래처별 발주 관리"}
        icon="📦"
        action={selectedVendor && (
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-outline btn-sm" onClick={() => createOrder("all")}>전체 품목 발주서</button>
            <button className="btn btn-primary btn-sm" onClick={() => createOrder("shortage")}>부족 품목 발주서</button>
          </div>
        )}
      >
        {!selectedVendor ? (
          <div className="muted" style={{ padding: 12 }}>거래처를 먼저 등록하거나 선택해주세요.</div>
        ) : (
          <>
            <div className="vendor-detail-grid">
              <div>
                <div className="muted small">거래처 정보</div>
                <div className="bold" style={{ marginTop: 4 }}>{selectedVendor.name}</div>
                <div className="muted small">{selectedVendor.phone || "연락처 없음"} · {selectedVendor.address || "주소 없음"}</div>
              </div>
              <div>
                <div className="muted small">등록 품목</div>
                <div className="bold">{selectedItems.length}개</div>
              </div>
              <div>
                <div className="muted small">발주 필요</div>
                <div className="bold">{selectedItems.filter(needsOrder).length}개</div>
              </div>
              <div>
                <div className="muted small">진행 발주서</div>
                <div className="bold">{selectedOrders.filter((order) => order.status === "draft" || order.status === "ordered").length}건</div>
              </div>
            </div>

            <div className="inventory-form">
              <div className="spread" style={{ marginBottom: 12 }}>
                <div>
                  <div className="bold">{itemEditingId ? "발주 품목 수정" : "발주 품목 추가"}</div>
                  <div className="muted small">현재 재고가 최소 재고 이하이면 자동으로 발주 필요가 표시됩니다.</div>
                </div>
                {itemEditingId && <button className="btn btn-outline btn-sm" onClick={resetItemForm}>새 품목</button>}
              </div>
              <div className="grid grid-4" style={{ gap: 10 }}>
                <div>
                  <label className="field-label">품목명</label>
                  <input className="input" value={itemDraft.name} onChange={(e) => updateItemDraft("name", e.target.value)} placeholder="예: 김치" />
                </div>
                <div>
                  <label className="field-label">분류</label>
                  <select className="select" value={itemDraft.category} onChange={(e) => updateItemDraft("category", e.target.value as InventoryCategory)}>
                    {CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">보관</label>
                  <select className="select" value={itemDraft.storageType} onChange={(e) => updateItemDraft("storageType", e.target.value as StorageType)}>
                    {STORAGE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">단위</label>
                  <input className="input" value={itemDraft.unit} onChange={(e) => updateItemDraft("unit", e.target.value)} placeholder="kg, 박스, 병" />
                </div>
              </div>
              <div className="grid grid-4" style={{ gap: 10, marginTop: 10 }}>
                <div>
                  <label className="field-label">현재 재고</label>
                  <input className="input" type="number" value={itemDraft.currentQty} onChange={(e) => updateItemDraft("currentQty", Number(e.target.value))} />
                </div>
                <div>
                  <label className="field-label">최소 재고</label>
                  <input className="input" type="number" value={itemDraft.minQty} onChange={(e) => updateItemDraft("minQty", Number(e.target.value))} />
                </div>
                <div>
                  <label className="field-label">기본 발주 수량</label>
                  <input className="input" type="number" value={itemDraft.defaultOrderQty} onChange={(e) => updateItemDraft("defaultOrderQty", Number(e.target.value))} />
                </div>
                <div>
                  <label className="field-label">단가</label>
                  <input className="input" type="number" value={itemDraft.unitPrice} onChange={(e) => updateItemDraft("unitPrice", Number(e.target.value))} />
                </div>
              </div>
              <div style={{ marginTop: 10 }}>
                <label className="field-label">메모</label>
                <input className="input" value={itemDraft.memo ?? ""} onChange={(e) => updateItemDraft("memo", e.target.value)} placeholder="납품 요일, 규격, 주의사항" />
              </div>
              <div className="row" style={{ justifyContent: "flex-end", marginTop: 12, flexWrap: "wrap" }}>
                <button className="btn btn-outline" onClick={resetItemForm}>취소</button>
                <button className="btn btn-primary" onClick={saveItem}>{itemEditingId ? "품목 수정" : "품목 등록"}</button>
              </div>
            </div>

            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table className="table inventory-table">
                <thead>
                  <tr>
                    <th>품목</th>
                    <th>분류</th>
                    <th>보관</th>
                    <th>현재</th>
                    <th>최소</th>
                    <th>기본발주</th>
                    <th>단가</th>
                    <th>상태</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedItems.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="bold">{item.name}</div>
                        {item.memo && <div className="muted small">{item.memo}</div>}
                      </td>
                      <td>{item.category}</td>
                      <td>{item.storageType}</td>
                      <td className="num">{item.currentQty}{item.unit}</td>
                      <td className="num">{item.minQty}{item.unit}</td>
                      <td className="num">{item.defaultOrderQty}{item.unit}</td>
                      <td className="num">{money.format(item.unitPrice)}원</td>
                      <td>{needsOrder(item) ? <Badge tone="amber">발주 필요</Badge> : <Badge>정상</Badge>}</td>
                      <td>
                        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                          <button className="btn btn-outline btn-sm" onClick={() => editItem(item)}>수정</button>
                          <button className="btn btn-danger btn-sm" onClick={() => removeItem(item)}>삭제</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {selectedItems.length === 0 && (
                    <tr>
                      <td colSpan={9} className="muted" style={{ textAlign: "center", padding: 24 }}>
                        등록된 발주 품목이 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="vendor-orders">
              <div className="spread" style={{ marginBottom: 10 }}>
                <div>
                  <div className="bold">발주서</div>
                  <div className="muted small">작성중 발주서는 수량과 단가를 바로 수정할 수 있습니다.</div>
                </div>
              </div>
              {selectedOrders.map((order) => (
                <div className="vendor-order-card" key={order.id}>
                  <div className="spread" style={{ gap: 10 }}>
                    <div>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <strong>발주서 #{order.id}</strong>
                        <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Badge>
                      </div>
                      <div className="muted small">{order.createdAt.slice(0, 16).replace("T", " ")} · 합계 {money.format(order.totalAmount)}원</div>
                    </div>
                    <div className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button className="btn btn-outline btn-sm" onClick={() => copyOrder(order)}>복사</button>
                      {order.status === "draft" && (
                        <button className="btn btn-outline btn-sm" onClick={() => updateOrder(order, { status: "ordered", orderedAt: new Date().toISOString() })}>발주완료</button>
                      )}
                      {(order.status === "draft" || order.status === "ordered") && (
                        <button className="btn btn-primary btn-sm" onClick={() => receivePurchaseOrder(order.id)}>입고 처리</button>
                      )}
                      {order.status !== "received" && (
                        <button className="btn btn-danger btn-sm" onClick={() => deletePurchaseOrder(order.id)}>삭제</button>
                      )}
                    </div>
                  </div>
                  <div className="order-line-list">
                    {order.items.map((item) => (
                      <div className="order-line-edit" key={item.inventoryItemId}>
                        <div>
                          <strong>{item.name}</strong>
                          <span className="muted small"> / {item.unit}</span>
                        </div>
                        <input
                          className="input"
                          type="number"
                          value={item.qty}
                          disabled={order.status === "received"}
                          onChange={(e) => updateOrderLine(order, item.inventoryItemId, { qty: Number(e.target.value) })}
                        />
                        <input
                          className="input"
                          type="number"
                          value={item.unitPrice}
                          disabled={order.status === "received"}
                          onChange={(e) => updateOrderLine(order, item.inventoryItemId, { unitPrice: Number(e.target.value) })}
                        />
                        <div className="num bold">{money.format(item.totalPrice)}원</div>
                      </div>
                    ))}
                  </div>
                  <input
                    className="input"
                    value={order.memo ?? ""}
                    disabled={order.status === "received"}
                    onChange={(e) => updateOrder(order, { memo: e.target.value })}
                    placeholder="발주 메모"
                  />
                </div>
              ))}
              {selectedOrders.length === 0 && (
                <div className="muted" style={{ padding: "14px 0" }}>아직 발주서가 없습니다. 부족 품목 발주서를 만들어보세요.</div>
              )}
            </div>
          </>
        )}
      </Card>
    </>
  );
}
