import { useMemo, useState, type CSSProperties, type DragEvent } from "react";
import type {
  GranterFinanceCategory,
  GranterFinanceDomain,
  GranterFinanceItem,
  Role,
} from "../data/types";
import { Badge, Card, StatCard } from "./ui";
import { money } from "../lib/sales";

const CATEGORY_COLORS = ["#42613d", "#2f6f8f", "#8b5e34", "#8a4f63", "#6d5b8c", "#b16a2f"];

function detailValue(detail: Record<string, unknown> | null, keys: string[]): string {
  if (!detail) return "";
  for (const key of keys) {
    const value = detail[key];
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  for (const value of Object.values(detail)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = detailValue(value as Record<string, unknown>, keys);
      if (nested) return nested;
    }
  }
  return "";
}

function itemTitle(item: GranterFinanceItem): string {
  return item.content
    || item.contactName
    || detailValue(item.detail, ["storeName", "merchantName", "organizationName", "accountName", "assetName"])
    || (item.domain === "card" ? "카드 거래" : "계좌 거래");
}

function itemMeta(item: GranterFinanceItem): string {
  if (item.domain === "card") {
    const organization = detailValue(item.detail, ["organizationName", "cardCompanyName", "issuerName"]);
    const approval = detailValue(item.detail, ["approvalNumber", "approvalNo"]);
    return [organization, approval ? `승인 ${approval}` : ""].filter(Boolean).join(" · ");
  }
  const organization = detailValue(item.detail, ["organizationName", "bankName"]);
  const account = detailValue(item.detail, ["accountNumber", "assetNumber"]);
  return [organization, account].filter(Boolean).join(" · ");
}

function ticketLabel(item: GranterFinanceItem): string {
  if (item.ticketType === "MERCHANT_CARD_TRANSACTION_TICKET") return "승인매출";
  if (item.ticketType === "MERCHANT_CARD_SETTLEMENT_DETAIL_TICKET") return "정산상세";
  return item.direction === "in" ? "입금" : "출금";
}

function createCategoryId(domain: GranterFinanceDomain): string {
  return `${domain}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

interface GranterFinanceBoardProps {
  role: Role;
  cardItems: GranterFinanceItem[];
  accountItems: GranterFinanceItem[];
  categories: GranterFinanceCategory[];
  classifyItems: (domain: GranterFinanceDomain, itemIds: string[], categoryId: string | null) => Promise<void>;
  upsertCategory: (category: GranterFinanceCategory) => Promise<void>;
  deleteCategory: (categoryId: string) => Promise<void>;
}

export default function GranterFinanceBoard({
  role,
  cardItems,
  accountItems,
  categories,
  classifyItems,
  upsertCategory,
  deleteCategory,
}: GranterFinanceBoardProps) {
  const [domain, setDomain] = useState<GranterFinanceDomain>("card");
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<GranterFinanceCategory | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryColor, setCategoryColor] = useState(CATEGORY_COLORS[0]);
  const [savingCategory, setSavingCategory] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const canClassify = role === "admin";
  const items = domain === "card" ? cardItems : accountItems;
  const domainCategories = categories.filter((category) => category.domain === domain);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (dateFrom && item.businessDate < dateFrom) return false;
      if (dateTo && item.businessDate > dateTo) return false;
      if (categoryFilter === "unclassified" && item.categoryId) return false;
      if (categoryFilter !== "all" && categoryFilter !== "unclassified" && item.categoryId !== categoryFilter) return false;
      if (!needle) return true;
      return [itemTitle(item), itemMeta(item), item.description, item.categoryName, String(item.amount)]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [categoryFilter, dateFrom, dateTo, items, query]);

  const totals = useMemo(() => ({
    inAmount: items.filter((item) => item.direction === "in").reduce((sum, item) => sum + Math.abs(item.amount), 0),
    outAmount: items.filter((item) => item.direction === "out").reduce((sum, item) => sum + Math.abs(item.amount), 0),
    unclassified: items.filter((item) => !item.categoryId).length,
  }), [items]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const visibleSelectedCount = filteredItems.filter((item) => selectedSet.has(item.id)).length;
  const allVisibleSelected = filteredItems.length > 0 && visibleSelectedCount === filteredItems.length;

  const changeDomain = (next: GranterFinanceDomain) => {
    setDomain(next);
    setCategoryFilter("all");
    setSelectedIds([]);
  };

  const toggleItem = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id]);
  };

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      const visibleIds = new Set(filteredItems.map((item) => item.id));
      setSelectedIds((current) => current.filter((id) => !visibleIds.has(id)));
    } else {
      setSelectedIds((current) => Array.from(new Set([...current, ...filteredItems.map((item) => item.id)])));
    }
  };

  const moveItems = async (itemIds: string[], categoryId: string | null) => {
    if (!canClassify || itemIds.length === 0 || classifying) return;
    setClassifying(true);
    try {
      await classifyItems(domain, itemIds, categoryId);
      setSelectedIds([]);
    } finally {
      setClassifying(false);
    }
  };

  const dragStart = (event: DragEvent<HTMLDivElement>, itemId: string) => {
    if (!canClassify) return;
    const itemIds = selectedSet.has(itemId) ? selectedIds : [itemId];
    if (!selectedSet.has(itemId)) setSelectedIds([itemId]);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/json", JSON.stringify({ domain, itemIds }));
  };

  const dropInto = (event: DragEvent<HTMLDivElement>, categoryId: string | null) => {
    event.preventDefault();
    try {
      const payload = JSON.parse(event.dataTransfer.getData("application/json")) as {
        domain?: GranterFinanceDomain;
        itemIds?: string[];
      };
      if (payload.domain !== domain || !Array.isArray(payload.itemIds)) return;
      void moveItems(payload.itemIds, categoryId);
    } catch {
      // 다른 드래그 데이터는 무시합니다.
    }
  };

  const openCategoryEditor = (category?: GranterFinanceCategory) => {
    setEditingCategory(category ?? null);
    setCategoryName(category?.name ?? "");
    setCategoryColor(category?.color ?? CATEGORY_COLORS[0]);
    setEditorOpen(true);
  };

  const saveCategory = async () => {
    if (!categoryName.trim() || savingCategory) return;
    setSavingCategory(true);
    try {
      await upsertCategory({
        id: editingCategory?.id ?? createCategoryId(domain),
        name: categoryName.trim(),
        domain,
        color: categoryColor,
        sortOrder: editingCategory?.sortOrder ?? domainCategories.length + 1,
        createdAt: editingCategory?.createdAt,
      });
      setEditorOpen(false);
    } finally {
      setSavingCategory(false);
    }
  };

  const removeCategory = async (category: GranterFinanceCategory) => {
    if (!window.confirm(`'${category.name}' 분류함을 삭제할까요? 포함된 거래는 미분류로 이동합니다.`)) return;
    await deleteCategory(category.id);
    if (categoryFilter === category.id) setCategoryFilter("all");
  };

  return (
    <>
      <Card
        title="카드·계좌 거래 분류"
        icon="🗂️"
        action={canClassify ? <button className="btn btn-primary btn-sm" onClick={() => openCategoryEditor()}>+ 분류함 만들기</button> : undefined}
      >
        <div className="granter-domain-tabs segmented">
          <button className={domain === "card" ? "on" : ""} onClick={() => changeDomain("card")}>카드 {cardItems.length}건</button>
          <button className={domain === "account" ? "on" : ""} onClick={() => changeDomain("account")}>계좌 {accountItems.length}건</button>
        </div>

        <div className="grid grid-4 granter-stats">
          <StatCard label="전체 거래" value={items.length} unit="건" icon={domain === "card" ? "💳" : "🏦"} />
          <StatCard label="입금·매출" value={money(totals.inAmount)} unit="원" icon="↘" tone="blue" />
          <StatCard label="출금·차감" value={money(totals.outAmount)} unit="원" icon="↗" tone="amber" />
          <StatCard label="미분류" value={totals.unclassified} unit="건" icon="📥" tone="amber" />
        </div>

        <div className="granter-filter-bar">
          <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="거래처, 은행, 승인번호, 금액 검색" />
          <input className="input" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="조회 시작일" />
          <input className="input" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="조회 종료일" />
          <select className="input" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="분류 필터">
            <option value="all">전체 분류</option>
            <option value="unclassified">미분류</option>
            {domainCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </div>

        <div className="granter-workspace">
          <div className="granter-ledger">
            <div className="granter-selection-bar">
              <label className="check-label">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} />
                현재 목록 전체선택
              </label>
              <span className="muted small">{selectedIds.length}건 선택</span>
              {selectedIds.length > 0 && <button className="btn btn-outline btn-sm" onClick={() => setSelectedIds([])}>선택해제</button>}
              {canClassify && selectedIds.length > 0 && <button className="btn btn-outline btn-sm" disabled={classifying} onClick={() => void moveItems(selectedIds, null)}>미분류로</button>}
            </div>

            <div className="granter-list" aria-label={`${domain === "card" ? "카드" : "계좌"} 거래 목록`}>
              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  className={`granter-row ${selectedSet.has(item.id) ? "selected" : ""}`}
                  draggable={canClassify}
                  onDragStart={(event) => dragStart(event, item.id)}
                >
                  <label className="granter-row-check">
                    <input type="checkbox" checked={selectedSet.has(item.id)} onChange={() => toggleItem(item.id)} />
                    <span className="sr-only">{itemTitle(item)} 선택</span>
                  </label>
                  <div className="granter-row-main">
                    <div className="granter-row-title">
                      <strong>{itemTitle(item)}</strong>
                      <Badge tone={item.direction === "in" ? "green" : "amber"}>{ticketLabel(item)}</Badge>
                    </div>
                    <div className="muted small">{item.businessDate} {item.transactedAt.slice(11, 16)}{itemMeta(item) ? ` · ${itemMeta(item)}` : ""}</div>
                    {item.description && <div className="granter-row-note">{item.description}</div>}
                  </div>
                  <div className="granter-row-amount">
                    <strong className={item.direction === "out" ? "out" : "in"}>{item.direction === "out" ? "-" : "+"}{money(Math.abs(item.amount))}원</strong>
                    <span className="category-pill" style={{ borderColor: domainCategories.find((category) => category.id === item.categoryId)?.color }}>
                      {item.categoryName || "미분류"}
                    </span>
                  </div>
                </div>
              ))}
              {filteredItems.length === 0 && <div className="empty-state">조건에 맞는 거래가 없습니다.</div>}
            </div>
          </div>

          <aside className="granter-category-board">
            <div className="granter-category-head">
              <div>
                <strong>{domain === "card" ? "카드" : "계좌"} 분류함</strong>
                <div className="muted small">끌어 놓거나 선택 후 이동하세요</div>
              </div>
            </div>
            <div
              className={`granter-category-dropzone unclassified ${categoryFilter === "unclassified" ? "active" : ""}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropInto(event, null)}
            >
              <button className="granter-category-filter" onClick={() => setCategoryFilter("unclassified")}>
                <span className="category-dot muted-dot" />
                <span>미분류</span>
                <b>{totals.unclassified}</b>
              </button>
              {canClassify && selectedIds.length > 0 && <button className="category-move-btn" disabled={classifying} onClick={() => void moveItems(selectedIds, null)}>여기로 이동</button>}
            </div>
            {domainCategories.map((category) => {
              const count = items.filter((item) => item.categoryId === category.id).length;
              return (
                <div
                  key={category.id}
                  className={`granter-category-dropzone ${categoryFilter === category.id ? "active" : ""}`}
                  style={{ "--category-color": category.color } as CSSProperties}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => dropInto(event, category.id)}
                >
                  <button className="granter-category-filter" onClick={() => setCategoryFilter(category.id)}>
                    <span className="category-dot" style={{ background: category.color }} />
                    <span>{category.name}</span>
                    <b>{count}</b>
                  </button>
                  <div className="granter-category-actions">
                    {canClassify && selectedIds.length > 0 && <button className="category-move-btn" disabled={classifying} onClick={() => void moveItems(selectedIds, category.id)}>여기로 이동</button>}
                    {canClassify && <button className="icon-btn-sm" title="분류함 수정" onClick={() => openCategoryEditor(category)}>✎</button>}
                    {canClassify && <button className="icon-btn-sm danger" title="분류함 삭제" onClick={() => void removeCategory(category)}>×</button>}
                  </div>
                </div>
              );
            })}
            {domainCategories.length === 0 && (
              <div className="granter-category-empty">
                <p>아직 만든 분류함이 없습니다.</p>
                {canClassify && <button className="btn btn-outline btn-sm" onClick={() => openCategoryEditor()}>첫 분류함 만들기</button>}
              </div>
            )}
            {!canClassify && <div className="muted small granter-readonly-note">관리자만 분류를 변경할 수 있습니다.</div>}
          </aside>
        </div>
      </Card>

      {editorOpen && (
        <div className="modal-backdrop" onClick={() => setEditorOpen(false)}>
          <div className="modal-panel granter-category-modal" role="dialog" aria-modal="true" aria-labelledby="granter-category-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2 id="granter-category-title">{editingCategory ? "분류함 수정" : "새 분류함"}</h2>
                <p>{domain === "card" ? "카드" : "계좌"} 거래에 사용할 이름을 자유롭게 적어주세요.</p>
              </div>
              <button className="icon-btn" aria-label="닫기" onClick={() => setEditorOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              <label>
                <span className="field-label">분류 이름</span>
                <input className="input" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="예: 카드 입금, 식자재비, 공과금" autoFocus />
              </label>
              <div>
                <span className="field-label">표시 색상</span>
                <div className="category-color-swatches">
                  {CATEGORY_COLORS.map((color) => (
                    <button
                      key={color}
                      className={categoryColor === color ? "selected" : ""}
                      style={{ background: color }}
                      aria-label={`${color} 색상`}
                      onClick={() => setCategoryColor(color)}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setEditorOpen(false)}>취소</button>
              <button className="btn btn-primary" disabled={!categoryName.trim() || savingCategory} onClick={() => void saveCategory()}>{savingCategory ? "저장 중..." : "저장"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
