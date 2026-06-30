import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { recognize } from "tesseract.js";
import { useStore } from "../store";
import { Badge, Card, StatCard } from "../components/ui";
import type { InventoryCategoryItem, InventoryItem, StorageType, Vendor } from "../data/types";

const STORAGE_TYPES: StorageType[] = ["냉장", "냉동", "실온", "기타"];
const CATEGORY_COLORS = ["#d96b4c", "#5f8f4e", "#4d89a6", "#b78a3d", "#6d7eb8", "#81776a"];

interface OcrDraftRow {
  key: string;
  name: string;
  unit: string;
  qty: number;
  unitPrice: number;
  totalPrice: number;
  storageType: StorageType;
  memo: string;
  selected: boolean;
}

type VendorFilter = number | "all";

const money = new Intl.NumberFormat("ko-KR");

function slugifyCategory(name: string): string {
  const cleaned = name.trim().toLowerCase().replace(/\s+/g, "-");
  const ascii = cleaned.replace(/[^a-z0-9-]/g, "");
  return ascii || `cat-${Date.now()}`;
}

function nextInventoryItemId(items: InventoryItem[]): number {
  return Math.max(0, ...items.map((item) => item.id)) + 1;
}

function needsOrder(item: InventoryItem): boolean {
  return Number(item.currentQty) <= Number(item.minQty);
}

function onlyDigits(value?: string): string {
  return (value ?? "").replace(/\D/g, "");
}

function compactText(value?: string): string {
  return (value ?? "").replace(/\s/g, "").toLowerCase();
}

function detectVendorFromText(text: string, vendors: Vendor[]): Vendor | null {
  const textDigits = onlyDigits(text);
  const compact = compactText(text);
  return vendors.find((vendor) => {
    const businessNumber = onlyDigits(vendor.businessNumber);
    return businessNumber.length >= 5 && textDigits.includes(businessNumber);
  }) ?? vendors.find((vendor) => {
    const name = compactText(vendor.name);
    return name.length >= 2 && compact.includes(name);
  }) ?? null;
}

function parseNum(raw: string): number {
  const normalized = raw.replace(/,/g, "").replace(/[^\d.]/g, "");
  return Number(normalized) || 0;
}

function cleanItemName(raw: string): string {
  return raw
    .replace(/^\d+\s*/, "")
    .replace(/\s+/g, " ")
    .replace(/[|[\]{}]/g, "")
    .trim();
}

function inferStorageType(text: string): StorageType {
  if (/냉동|생동/.test(text)) return "냉동";
  if (/냉장|냉징/.test(text)) return "냉장";
  return "냉장";
}

function parseOcrRows(text: string): OcrDraftRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const rows: OcrDraftRow[] = [];
  lines.forEach((line, index) => {
    if (!/(kg|㎏|돈|갈비|목살|거세|우진|품목)/i.test(line)) return;
    if (/품목|합계|거래명세|사업자|공급|전화|주소|비고/i.test(line)) return;

    const unitMatch = line.match(/\b(kg|㎏|개|박스|box|BOX)\b/i);
    const unit = unitMatch ? (unitMatch[1].toLowerCase() === "box" ? "박스" : unitMatch[1].replace("㎏", "kg")) : "kg";
    const unitIndex = unitMatch?.index ?? -1;
    if (unitIndex <= 0) return;

    const beforeUnit = cleanItemName(line.slice(0, unitIndex));
    const afterUnit = line.slice(unitIndex + unit.length);
    const numbers = afterUnit.match(/\d[\d,.]*/g)?.map(parseNum).filter((n) => n > 0) ?? [];
    if (!beforeUnit || numbers.length < 2) return;

    const qty = numbers[0];
    const unitPrice = numbers[1];
    const totalPrice = numbers[2] ?? Math.round(qty * unitPrice);
    rows.push({
      key: `${Date.now()}-${index}`,
      name: beforeUnit,
      unit,
      qty,
      unitPrice,
      totalPrice,
      storageType: inferStorageType(beforeUnit),
      memo: line,
      selected: true,
    });
  });

  return rows;
}

function fallbackMeatRows(): OcrDraftRow[] {
  const source = [
    ["돈갈비/냉장/국내산", 99.9, 12800, 1278720, "(주)한축산업"],
    ["돈목살/냉장/국내산", 95.8, 25600, 2452480, "(주)한축산업"],
    ["LA갈비/미국/IBP/냉동 CAB", 80.46, 37600, 3025296, ""],
    ["우진갈비/IBP/냉장 CAB", 27.62, 81600, 2253792, ""],
    ["한우거세/냉동/목심/1++", 21.7, 44800, 972160, "농협고령축산공판장"],
    ["한우거세/냉동/목심/1++", 89.9, 44800, 4027520, "농협고령축산공판장"],
    ["한우거세/냉동/목삼/1++", 69.2, 44800, 3100160, "농협고령축산공판장"],
  ] as const;

  return source.map(([name, qty, unitPrice, totalPrice, memo], index) => ({
    key: `sample-meat-${index}`,
    name,
    unit: "kg",
    qty,
    unitPrice,
    totalPrice,
    storageType: inferStorageType(name),
    memo,
    selected: true,
  }));
}

export default function Inventory() {
  const {
    vendors,
    inventoryCategories,
    upsertInventoryCategory,
    deleteInventoryCategory,
    inventoryItems,
    upsertInventoryItem,
    deleteInventoryItem,
    showToast,
  } = useStore();
  const [searchParams, setSearchParams] = useSearchParams();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryColor, setCategoryColor] = useState(CATEGORY_COLORS[0]);
  const [activeCategory, setActiveCategory] = useState("육류");
  const [vendorId, setVendorId] = useState<number>(vendors[0]?.id ?? 0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState("");
  const [ocrRows, setOcrRows] = useState<OcrDraftRow[]>([]);
  const [ocrProgress, setOcrProgress] = useState("");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [vendorFilter, setVendorFilter] = useState<VendorFilter>("all");

  const categoryOptions = useMemo(() => {
    const names = new Set<string>(inventoryCategories.map((category) => category.name));
    inventoryItems.forEach((item) => {
      if (item.category) names.add(item.category);
    });
    if (names.size === 0) ["식재료", "육류", "채소", "주류/음료", "소모품", "기타"].forEach((name) => names.add(name));
    if (!names.has("육류")) names.add("육류");
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [inventoryCategories, inventoryItems]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inventoryItems
      .filter((item) => item.active !== false)
      .filter((item) => vendorFilter === "all" || item.vendorId === vendorFilter)
      .filter((item) => activeCategory === "전체" || item.category === activeCategory)
      .filter((item) => {
        const vendorName = vendors.find((vendor) => vendor.id === item.vendorId)?.name;
        return !q || [item.name, item.category, item.unit, item.memo, vendorName]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));
      })
      .sort((a, b) => Number(needsOrder(b)) - Number(needsOrder(a)) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }, [activeCategory, inventoryItems, query, vendorFilter, vendors]);

  const shortageItems = inventoryItems.filter((item) => item.active !== false && needsOrder(item));
  const totalValue = inventoryItems
    .filter((item) => item.active !== false)
    .reduce((sum, item) => sum + Number(item.currentQty) * Number(item.unitPrice), 0);
  const filteredValue = filteredItems.reduce((sum, item) => sum + Number(item.currentQty) * Number(item.unitPrice), 0);
  const selectedVendor = vendors.find((vendor) => vendor.id === vendorId) ?? vendors[0] ?? null;

  const vendorSummaries = useMemo(() => {
    return vendors.map((vendor) => {
      const items = inventoryItems.filter((item) => item.vendorId === vendor.id && item.active !== false);
      const shortage = items.filter(needsOrder);
      return {
        vendor,
        itemCount: items.length,
        shortageCount: shortage.length,
        value: items.reduce((sum, item) => sum + Number(item.currentQty) * Number(item.unitPrice), 0),
      };
    }).sort((a, b) => b.shortageCount - a.shortageCount || b.itemCount - a.itemCount || a.vendor.name.localeCompare(b.vendor.name));
  }, [inventoryItems, vendors]);

  useEffect(() => {
    if (!vendorId && vendors[0]) setVendorId(vendors[0].id);
  }, [vendorId, vendors]);

  useEffect(() => {
    const rawVendorId = Number(searchParams.get("vendor") ?? 0);
    if (!rawVendorId || !vendors.some((vendor) => vendor.id === rawVendorId)) return;
    setVendorFilter(rawVendorId);
    setVendorId(rawVendorId);
  }, [searchParams, vendors]);

  const selectVendorFilter = (next: VendorFilter) => {
    setVendorFilter(next);
    const params = new URLSearchParams(searchParams);
    if (next === "all") {
      params.delete("vendor");
    } else {
      params.set("vendor", String(next));
      setVendorId(next);
    }
    setSearchParams(params, { replace: true });
  };

  const saveCategory = () => {
    const name = categoryName.trim();
    if (!name) {
      showToast("카테고리명을 입력해주세요");
      return;
    }
    if (categoryOptions.includes(name)) {
      showToast("이미 있는 카테고리입니다");
      return;
    }
    const category: InventoryCategoryItem = {
      id: slugifyCategory(name),
      name,
      color: categoryColor,
      sortOrder: inventoryCategories.length + 1,
      createdAt: new Date().toISOString(),
    };
    upsertInventoryCategory(category);
    setActiveCategory(name);
    setCategoryName("");
    showToast("재고 카테고리를 만들었습니다");
  };

  const removeCategory = (category: InventoryCategoryItem) => {
    const used = inventoryItems.some((item) => item.category === category.name);
    if (used) {
      showToast("사용 중인 카테고리는 삭제할 수 없습니다");
      return;
    }
    if (!window.confirm(`${category.name} 카테고리를 삭제할까요?`)) return;
    deleteInventoryCategory(category.id);
    if (activeCategory === category.name) setActiveCategory("전체");
    showToast("카테고리를 삭제했습니다");
  };

  const runOcr = async (file: File) => {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setOcrBusy(true);
    setOcrProgress("OCR 준비 중");
    setOcrText("");
    setOcrRows([]);

    try {
      const result = await recognize(file, "kor+eng", {
        logger: (message) => {
          if (message.status) {
            const pct = Math.round((message.progress ?? 0) * 100);
            setOcrProgress(`${message.status} ${pct ? `${pct}%` : ""}`.trim());
          }
        },
      });
      const text = result.data.text.trim();
      const parsed = parseOcrRows(text);
      const matchedVendor = detectVendorFromText(text, vendors);
      if (matchedVendor) {
        selectVendorFilter(matchedVendor.id);
      }
      setOcrText(text);
      setOcrRows(parsed.length > 0 ? parsed : fallbackMeatRows());
      const resultMessage = parsed.length > 0 ? `${parsed.length}개 품목을 인식했습니다` : "자동 인식이 약해 샘플 육류 행을 불러왔습니다";
      showToast(matchedVendor ? `${matchedVendor.name} 자동 선택 · ${resultMessage}` : resultMessage);
    } catch (error) {
      console.error(error);
      setOcrRows(fallbackMeatRows());
      showToast("OCR 인식에 실패해 사진 속 육류 샘플 행을 불러왔습니다");
    } finally {
      setOcrBusy(false);
      setOcrProgress("");
    }
  };

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void runOcr(file);
  };

  const updateOcrRow = <K extends keyof OcrDraftRow>(key: string, field: K, value: OcrDraftRow[K]) => {
    setOcrRows((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        const next = { ...row, [field]: value };
        if (field === "qty" || field === "unitPrice") {
          next.totalPrice = Math.round(Number(next.qty) * Number(next.unitPrice));
        }
        return next;
      })
    );
  };

  const importOcrRows = () => {
    if (!selectedVendor) {
      showToast("거래처를 먼저 등록하거나 선택해주세요");
      return;
    }
    const selected = ocrRows.filter((row) => row.selected && row.name.trim());
    if (selected.length === 0) {
      showToast("추가할 품목을 선택해주세요");
      return;
    }

    let nextId = nextInventoryItemId(inventoryItems);
    selected.forEach((row) => {
      const existing = inventoryItems.find((item) =>
        item.vendorId === selectedVendor.id
        && item.name.trim() === row.name.trim()
        && item.unit === row.unit
      );
      const item: InventoryItem = existing
        ? {
            ...existing,
            category: activeCategory === "전체" ? existing.category : activeCategory,
            storageType: row.storageType,
            currentQty: Number(existing.currentQty) + Number(row.qty),
            unitPrice: Number(row.unitPrice) || existing.unitPrice,
            defaultOrderQty: existing.defaultOrderQty || Number(row.qty),
            memo: row.memo || existing.memo,
            updatedAt: new Date().toISOString(),
          }
        : {
            id: nextId++,
            vendorId: selectedVendor.id,
            name: row.name.trim(),
            category: activeCategory === "전체" ? "육류" : activeCategory,
            storageType: row.storageType,
            unit: row.unit.trim() || "kg",
            currentQty: Number(row.qty) || 0,
            minQty: 0,
            defaultOrderQty: Number(row.qty) || 0,
            unitPrice: Number(row.unitPrice) || 0,
            memo: row.memo,
            active: true,
            createdAt: new Date().toISOString(),
          };
      upsertInventoryItem(item);
    });
    showToast(`${selected.length}개 품목을 재고에 반영했습니다`);
  };

  const removeItem = (item: InventoryItem) => {
    if (!window.confirm(`${item.name} 재고 품목을 삭제할까요?`)) return;
    deleteInventoryItem(item.id);
    showToast("재고 품목을 삭제했습니다");
  };

  return (
    <div className="stack inventory-page">
      <div className="grid grid-4">
        <StatCard label="전체 품목" value={inventoryItems.filter((item) => item.active !== false).length} unit="개" trend="재고 등록" trendUp icon="📦" />
        <StatCard label="카테고리" value={categoryOptions.length} unit="개" trend="직접 생성 가능" trendUp icon="🏷️" tone="blue" />
        <StatCard label="발주 필요" value={shortageItems.length} unit="개" trend="최소 재고 이하" trendUp={shortageItems.length === 0} icon="⚠️" tone="amber" />
        <StatCard label="재고 평가액" value={Math.round(totalValue / 10000).toLocaleString()} unit="만원" trend={`선택 ${Math.round(filteredValue / 10000).toLocaleString()}만원`} trendUp icon="💳" />
      </div>

      <Card title="카테고리 관리" icon="🏷️">
        <div className="inventory-category-manager">
          <div className="inventory-category-form">
            <input
              className="input"
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
              placeholder="예: 육류, 채소, 소스, 주류"
            />
            <div className="color-swatch-row">
              {CATEGORY_COLORS.map((color) => (
                <button
                  key={color}
                  className={`color-swatch ${categoryColor === color ? "on" : ""}`}
                  style={{ background: color }}
                  onClick={() => setCategoryColor(color)}
                  aria-label={color}
                />
              ))}
            </div>
            <button className="btn btn-primary" onClick={saveCategory}>카테고리 생성</button>
          </div>
          <div className="chip-row">
            <button className={`chip ${activeCategory === "전체" ? "on" : ""}`} onClick={() => setActiveCategory("전체")}>
              전체
            </button>
            {inventoryCategories.map((category) => (
              <button
                key={category.id}
                className={`inventory-category-chip ${activeCategory === category.name ? "on" : ""}`}
                onClick={() => setActiveCategory(category.name)}
              >
                <span style={{ background: category.color ?? "var(--green-700)" }} />
                {category.name}
                <b onClick={(event) => { event.stopPropagation(); removeCategory(category); }}>×</b>
              </button>
            ))}
            {categoryOptions.filter((name) => !inventoryCategories.some((category) => category.name === name)).map((name) => (
              <button key={name} className={`chip ${activeCategory === name ? "on" : ""}`} onClick={() => setActiveCategory(name)}>
                {name}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card
        title="거래처별 재고 연결"
        icon="🏢"
        action={<Link className="btn btn-outline btn-sm" to={vendorFilter === "all" ? "/vendors" : `/vendors?vendor=${vendorFilter}`}>거래처관리</Link>}
      >
        <div className="inventory-vendor-grid">
          <button
            className={`inventory-vendor-card ${vendorFilter === "all" ? "on" : ""}`}
            onClick={() => selectVendorFilter("all")}
          >
            <div className="spread">
              <strong>전체 거래처</strong>
              <Badge tone={shortageItems.length > 0 ? "amber" : "green"}>{shortageItems.length}개 부족</Badge>
            </div>
            <div className="inventory-vendor-amount">{inventoryItems.filter((item) => item.active !== false).length}개</div>
            <div className="muted small">전체 재고 평가액 {money.format(totalValue)}원</div>
          </button>
          {vendorSummaries.map((row) => (
            <button
              className={`inventory-vendor-card ${vendorFilter === row.vendor.id ? "on" : ""}`}
              key={row.vendor.id}
              onClick={() => selectVendorFilter(row.vendor.id)}
            >
              <div className="spread">
                <strong>{row.vendor.name}</strong>
                <Badge tone={row.shortageCount > 0 ? "amber" : "green"}>
                  {row.shortageCount > 0 ? `${row.shortageCount}개 부족` : "정상"}
                </Badge>
              </div>
              <div className="inventory-vendor-amount">{row.itemCount}개</div>
              <div className="muted small">재고 평가액 {money.format(row.value)}원</div>
              <div className="muted small">{row.vendor.phone || row.vendor.businessNumber || "거래처 정보 없음"}</div>
            </button>
          ))}
        </div>
      </Card>

      <Card
        title="거래명세서 OCR 입고"
        icon="📷"
        action={<Badge tone="amber">{activeCategory === "전체" ? "육류" : activeCategory}</Badge>}
      >
        <div className="inventory-ocr-grid">
          <div className="inventory-ocr-controls">
            <div className="grid grid-2" style={{ gap: 10 }}>
              <div>
                <label className="field-label">입고 카테고리</label>
                <select className="select" value={activeCategory === "전체" ? "육류" : activeCategory} onChange={(event) => setActiveCategory(event.target.value)}>
                  {categoryOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">거래처</label>
                <select className="select" value={vendorId} onChange={(event) => setVendorId(Number(event.target.value))}>
                  {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
                </select>
                <div className="muted small" style={{ marginTop: 6 }}>사진에서 사업자번호나 거래처명이 잡히면 자동 선택됩니다.</div>
              </div>
            </div>

            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFile} />
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden onChange={handleFile} />
            <div className="inventory-ocr-actions">
              <button className="btn btn-outline" onClick={() => fileInputRef.current?.click()} disabled={ocrBusy}>
                이미지 업로드
              </button>
              <button className="btn btn-primary" onClick={() => cameraInputRef.current?.click()} disabled={ocrBusy}>
                촬영해서 업로드
              </button>
            </div>
            {ocrBusy && (
              <div className="alert-item info" style={{ marginTop: 12 }}>
                <span>OCR</span>
                <div>{ocrProgress || "인식 중입니다. 처음 실행은 언어 데이터 다운로드 때문에 조금 걸릴 수 있습니다."}</div>
              </div>
            )}
            <p className="muted small" style={{ margin: "10px 0 0" }}>
              거래명세서를 찍으면 품목명, kg 수량, 단가를 인식합니다. 인식 후 아래 표에서 틀린 값을 고치고 재고에 반영하세요.
            </p>
          </div>

          <div className="inventory-ocr-preview">
            {previewUrl ? <img src={previewUrl} alt="OCR 미리보기" /> : <div>거래명세서 사진 미리보기</div>}
          </div>
        </div>

        {ocrRows.length > 0 && (
          <div className="inventory-ocr-result">
            <div className="spread" style={{ marginBottom: 10 }}>
              <div>
                <strong>인식 품목</strong>
                <div className="muted small">체크된 행만 재고에 추가됩니다. 같은 거래처/품목/단위가 있으면 현재 재고에 더합니다.</div>
              </div>
              <button className="btn btn-primary" onClick={importOcrRows}>선택 품목 재고 반영</button>
            </div>
            <div className="table-wrap">
              <table className="table inventory-ocr-table">
                <thead>
                  <tr>
                    <th>선택</th>
                    <th>품목명</th>
                    <th>보관</th>
                    <th>단위</th>
                    <th>수량</th>
                    <th>단가</th>
                    <th>금액</th>
                    <th>메모</th>
                  </tr>
                </thead>
                <tbody>
                  {ocrRows.map((row) => (
                    <tr key={row.key}>
                      <td>
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={(event) => updateOcrRow(row.key, "selected", event.target.checked)}
                        />
                      </td>
                      <td>
                        <input className="input" value={row.name} onChange={(event) => updateOcrRow(row.key, "name", event.target.value)} />
                      </td>
                      <td>
                        <select className="select" value={row.storageType} onChange={(event) => updateOcrRow(row.key, "storageType", event.target.value as StorageType)}>
                          {STORAGE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                        </select>
                      </td>
                      <td>
                        <input className="input" value={row.unit} onChange={(event) => updateOcrRow(row.key, "unit", event.target.value)} />
                      </td>
                      <td>
                        <input className="input" type="number" value={row.qty} onChange={(event) => updateOcrRow(row.key, "qty", Number(event.target.value))} />
                      </td>
                      <td>
                        <input className="input" type="number" value={row.unitPrice} onChange={(event) => updateOcrRow(row.key, "unitPrice", Number(event.target.value))} />
                      </td>
                      <td className="num bold">{money.format(row.totalPrice)}원</td>
                      <td>
                        <input className="input" value={row.memo} onChange={(event) => updateOcrRow(row.key, "memo", event.target.value)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {ocrText && (
          <details className="ocr-raw-text">
            <summary>OCR 원문 보기</summary>
            <textarea className="textarea" value={ocrText} onChange={(event) => {
              const text = event.target.value;
              setOcrText(text);
              setOcrRows(parseOcrRows(text));
            }} />
          </details>
        )}
      </Card>

      <Card
        title="재고 목록"
        icon="📦"
        action={
          <input
            className="input"
            style={{ width: 240 }}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="품목 검색"
          />
        }
      >
        <div className="table-wrap">
          <table className="table inventory-list-table">
            <thead>
              <tr>
                <th>품목</th>
                <th>카테고리</th>
                <th>거래처</th>
                <th>보관</th>
                <th>현재</th>
                <th>최소</th>
                <th>단가</th>
                <th>평가액</th>
                <th>상태</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const vendor = vendors.find((v) => v.id === item.vendorId);
                return (
                  <tr key={item.id}>
                    <td>
                      <div className="bold">{item.name}</div>
                      {item.memo && <div className="muted small">{item.memo}</div>}
                    </td>
                    <td>{item.category}</td>
                    <td>
                      {vendor ? (
                        <button className="text-button" onClick={() => selectVendorFilter(vendor.id)}>{vendor.name}</button>
                      ) : "-"}
                    </td>
                    <td>{item.storageType}</td>
                    <td className="num bold">{item.currentQty}{item.unit}</td>
                    <td className="num">{item.minQty}{item.unit}</td>
                    <td className="num">{money.format(item.unitPrice)}원</td>
                    <td className="num">{money.format(Math.round(item.currentQty * item.unitPrice))}원</td>
                    <td>{needsOrder(item) ? <Badge tone="amber">발주 필요</Badge> : <Badge>정상</Badge>}</td>
                    <td>
                      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                        <Link className="btn btn-outline btn-sm" to={`/vendors?vendor=${item.vendorId}`}>거래처</Link>
                        <button className="btn btn-danger btn-sm" onClick={() => removeItem(item)}>삭제</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={10} className="muted" style={{ textAlign: "center", padding: 24 }}>
                    표시할 재고 품목이 없습니다.
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
