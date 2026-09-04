import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Badge, Card, StatCard } from "../components/ui";
import type { Recipe, RecipeIngredient, RecipeKind } from "../data/types";
import { UNITS, UNIT_LABELS, type Unit, convertQuantity, convertUnitCost, normalizeUnit } from "../data/units";

/*
  레시피 원가.

  **원가율만 본다.** 인건비·운영비 배분은 뺐다 — 사장님이 보는 것은
  «이 메뉴 하나에 재료비가 판매가의 몇 %인가»다.

  **판매 메뉴와 기본 상차림을 가른다.** 김반찬·겉절이·쌈장은 판매가가 없다.
  한 표에 섞으면 상차림 원가율이 0% 로 찍혀 «마진 100%» 로 읽힌다.
*/

const money = new Intl.NumberFormat("ko-KR");

const PRESET_CATEGORIES = ["구이", "식사", "면", "찌개", "반찬", "김치", "육수·소스", "기타"];
const CUSTOM_CATEGORY = "__custom__";

const KIND_LABEL: Record<RecipeKind, string> = { menu: "판매 메뉴", side: "기본 상차림" };

const EMPTY_RECIPE: Recipe = {
  id: 0,
  name: "",
  category: "",
  kind: "menu",
  servings: 1,
  ingredients: [],
  salePrice: 0,
  memo: "",
  active: true,
};

function makeIngredient(): RecipeIngredient {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()),
    name: "",
    quantity: 1,
    unit: "kg",
    unitCost: 0,
  };
}

function nextRecipeId(recipes: Recipe[]): number {
  return Math.max(0, ...recipes.map((recipe) => recipe.id)) + 1;
}

export interface RecipeCost {
  totalCost: number;
  perServingCost: number;
  salePrice: number;
  /** 판매가 대비 재료비 %. 판매가가 없으면 null — 0% 가 아니다. */
  costRate: number | null;
  /** 수량이나 단가가 비어 있는 재료 수. 이게 있으면 원가는 «아직 덜 된 것»이다. */
  incomplete: number;
}

export function recipeCost(recipe: Recipe): RecipeCost {
  const totalCost = recipe.ingredients.reduce(
    (sum, ingredient) => sum + (Number(ingredient.quantity) || 0) * (Number(ingredient.unitCost) || 0),
    0
  );
  const salePrice = recipe.kind === "side" ? 0 : Number(recipe.salePrice) || 0;
  const servings = Math.max(1, Number(recipe.servings) || 1);
  const perServingCost = totalCost / servings;
  const incomplete = recipe.ingredients.filter(
    (ingredient) => !(Number(ingredient.quantity) > 0) || !(Number(ingredient.unitCost) > 0)
  ).length;
  return {
    totalCost,
    perServingCost,
    salePrice,
    costRate: salePrice > 0 ? (perServingCost / salePrice) * 100 : null,
    incomplete,
  };
}

function toNumber(value: string): number {
  return Number(value.replace(/[^0-9.]/g, "")) || 0;
}

/** 원가율 30% 아래면 좋고, 40% 넘으면 빨갛다 — 식당 재료비의 흔한 기준선. */
function costTone(rate: number | null): string {
  if (rate === null) return "gray";
  if (rate <= 30) return "green";
  if (rate <= 40) return "amber";
  return "red";
}

function costRateText(rate: number | null): string {
  return rate === null ? "—" : `${rate.toFixed(1)}%`;
}

export default function Recipes() {
  const { recipes, vendors, upsertRecipe, deleteRecipe, showToast } = useStore();
  const [draft, setDraft] = useState<Recipe>(EMPTY_RECIPE);
  const [customCategory, setCustomCategory] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  const categories = useMemo(() => {
    const names = new Set<string>(PRESET_CATEGORIES);
    recipes.forEach((recipe) => { if (recipe.category) names.add(recipe.category); });
    return [...names];
  }, [recipes]);

  const totals = useMemo(() => recipeCost(draft), [draft]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recipes;
    return recipes.filter((recipe) =>
      [recipe.name, recipe.category, recipe.memo, ...recipe.ingredients.map((ingredient) => ingredient.name)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [query, recipes]);
  const menuRecipes = filtered.filter((recipe) => recipe.kind !== "side");
  const sideRecipes = filtered.filter((recipe) => recipe.kind === "side");

  // 평균 원가율은 판매가가 있는 메뉴만으로 낸다 — 0원 메뉴를 넣으면 평균이 거짓말한다
  const pricedRates = recipes
    .map((recipe) => recipeCost(recipe).costRate)
    .filter((rate): rate is number => rate !== null);
  const averageCostRate = pricedRates.length
    ? pricedRates.reduce((sum, rate) => sum + rate, 0) / pricedRates.length
    : null;
  const menuCount = recipes.filter((recipe) => recipe.kind !== "side").length;
  const sideCount = recipes.length - menuCount;

  const updateDraft = <K extends keyof Recipe>(key: K, value: Recipe[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const updateIngredient = <K extends keyof RecipeIngredient>(
    id: string,
    key: K,
    value: RecipeIngredient[K]
  ) => {
    setDraft((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ingredient) =>
        ingredient.id === id ? { ...ingredient, [key]: value } : ingredient
      ),
    }));
  };

  /** 단위를 바꾸면 수량과 단가가 같이 환산돼 재료비는 그대로다 — 0.6kg×12,000 = 600g×12 */
  const changeUnit = (id: string, next: Unit) => {
    setDraft((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ingredient) => {
        if (ingredient.id !== id) return ingredient;
        const from = normalizeUnit(ingredient.unit);
        return {
          ...ingredient,
          unit: next,
          quantity: Number(convertQuantity(Number(ingredient.quantity) || 0, from, next).toFixed(4)),
          unitCost: Number(convertUnitCost(Number(ingredient.unitCost) || 0, from, next).toFixed(4)),
        };
      }),
    }));
  };

  const addIngredient = () => {
    setDraft((prev) => ({ ...prev, ingredients: [...prev.ingredients, makeIngredient()] }));
  };

  const removeIngredient = (id: string) => {
    setDraft((prev) => ({ ...prev, ingredients: prev.ingredients.filter((ingredient) => ingredient.id !== id) }));
  };

  const resetForm = () => {
    setDraft(EMPTY_RECIPE);
    setCustomCategory(false);
    setEditingId(null);
  };

  const editRecipe = (recipe: Recipe) => {
    setDraft({
      ...recipe,
      kind: recipe.kind === "side" ? "side" : "menu",
      ingredients: recipe.ingredients.map((ingredient) => ({ ...ingredient, unit: normalizeUnit(ingredient.unit) })),
    });
    setCustomCategory(Boolean(recipe.category) && !categories.includes(recipe.category));
    setEditingId(recipe.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveRecipe = () => {
    const name = draft.name.trim();
    if (!name) {
      showToast("레시피명을 입력해주세요");
      return;
    }
    const ingredients = draft.ingredients
      .map((ingredient) => ({
        ...ingredient,
        name: ingredient.name.trim(),
        unit: normalizeUnit(ingredient.unit),
        quantity: Number(ingredient.quantity) || 0,
        unitCost: Number(ingredient.unitCost) || 0,
        note: ingredient.note?.trim() || undefined,
      }))
      .filter((ingredient) => ingredient.name);
    if (ingredients.length === 0) {
      showToast("재료를 1개 이상 입력해주세요");
      return;
    }

    const recipe: Recipe = {
      ...draft,
      id: editingId ?? nextRecipeId(recipes),
      name,
      category: draft.category.trim(),
      kind: draft.kind === "side" ? "side" : "menu",
      servings: Math.max(1, Number(draft.servings) || 1),
      ingredients,
      salePrice: draft.kind === "side" ? 0 : Number(draft.salePrice) || 0,
      memo: draft.memo?.trim(),
      active: true,
      createdAt: draft.createdAt ?? new Date().toISOString(),
    };
    upsertRecipe(recipe);
    showToast(editingId ? "레시피를 수정했습니다" : "레시피를 등록했습니다");
    resetForm();
  };

  const removeRecipe = (recipe: Recipe) => {
    if (!window.confirm(`${recipe.name} 레시피를 삭제할까요?`)) return;
    deleteRecipe(recipe.id);
    if (editingId === recipe.id) resetForm();
    showToast("레시피를 삭제했습니다");
  };

  const vendorName = (vendorId?: number) =>
    vendorId ? vendors.find((vendor) => vendor.id === vendorId)?.name ?? "등록 거래처" : "미지정";

  const isSide = draft.kind === "side";
  const categorySelectValue = customCategory ? CUSTOM_CATEGORY : (draft.category || "");

  const renderIngredientCell = (recipe: Recipe) => (
    <>
      {recipe.ingredients.slice(0, 3).map((ingredient) => (
        <div className="muted small" key={ingredient.id}>
          {ingredient.name}
          {ingredient.quantity > 0 ? ` ${ingredient.quantity}${ingredient.unit}` : ""}
        </div>
      ))}
      {recipe.ingredients.length > 3 && <div className="muted small">외 {recipe.ingredients.length - 3}개</div>}
    </>
  );

  const renderActions = (recipe: Recipe) => (
    <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
      <button className="btn btn-outline btn-sm" onClick={() => editRecipe(recipe)}>수정</button>
      <button className="btn btn-danger btn-sm" onClick={() => removeRecipe(recipe)}>삭제</button>
    </div>
  );

  return (
    <>
      <div className="grid grid-4">
        <StatCard label="판매 메뉴" value={menuCount} unit="개" trend="원가율 계산 대상" trendUp icon="🥘" />
        <StatCard label="기본 상차림" value={sideCount} unit="개" trend="판매가 없음 · 원가만" trendUp icon="🥗" tone="blue" />
        <StatCard
          label="평균 원가율"
          value={averageCostRate === null ? "—" : averageCostRate.toFixed(1)}
          unit={averageCostRate === null ? undefined : "%"}
          trend={pricedRates.length ? `판매가 있는 ${pricedRates.length}개 기준` : "판매가를 넣으면 계산됩니다"}
          trendUp={averageCostRate === null || averageCostRate <= 35}
          icon="📊"
          tone="amber"
        />
        <StatCard
          label="작성 중 원가율"
          value={costRateText(totals.costRate)}
          trend={isSide ? "기본 상차림은 원가만 봅니다" : totals.salePrice ? `판매가 ${money.format(totals.salePrice)}원 대비` : "판매가를 넣어 주세요"}
          trendUp={totals.costRate === null || totals.costRate <= 35}
          icon="📈"
        />
      </div>

      <div className="grid grid-main-side">
        <div className="stack">
          <Card
            title={editingId ? "레시피 수정" : "레시피 등록"}
            icon="🥘"
            action={editingId ? <button className="btn btn-outline btn-sm" onClick={resetForm}>새 레시피</button> : undefined}
          >
            {/* 판매 메뉴인지 상차림인지가 먼저다 — 그에 따라 판매가 칸이 있고 없다 */}
            <div className="segmented fill" role="tablist" aria-label="레시피 종류" style={{ marginBottom: 14 }}>
              {(["menu", "side"] as RecipeKind[]).map((kind) => (
                <button
                  key={kind}
                  role="tab"
                  aria-selected={draft.kind === kind}
                  className={draft.kind === kind ? "on" : ""}
                  onClick={() => updateDraft("kind", kind)}
                >
                  {KIND_LABEL[kind]}
                </button>
              ))}
            </div>

            <div className="grid grid-4" style={{ gap: 12 }}>
              <div>
                <label className="field-label">레시피명</label>
                <input className="input" value={draft.name} onChange={(e) => updateDraft("name", e.target.value)} placeholder={isSide ? "예: 겉절이" : "예: 돼지갈비"} />
              </div>
              <div>
                <label className="field-label">분류</label>
                <select
                  className="select"
                  value={categorySelectValue}
                  onChange={(e) => {
                    if (e.target.value === CUSTOM_CATEGORY) {
                      setCustomCategory(true);
                      updateDraft("category", "");
                    } else {
                      setCustomCategory(false);
                      updateDraft("category", e.target.value);
                    }
                  }}
                >
                  <option value="">분류 선택</option>
                  {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                  <option value={CUSTOM_CATEGORY}>+ 직접 입력</option>
                </select>
                {customCategory && (
                  <input
                    className="input"
                    style={{ marginTop: 6 }}
                    value={draft.category}
                    onChange={(e) => updateDraft("category", e.target.value)}
                    placeholder="새 분류 이름"
                    autoFocus
                  />
                )}
              </div>
              <div>
                <label className="field-label">{isSide ? "제공 횟수(인분)" : "기준 인분"}</label>
                <input className="input" inputMode="numeric" value={draft.servings} onChange={(e) => updateDraft("servings", toNumber(e.target.value))} />
                <div className="muted small" style={{ marginTop: 4 }}>이 재료 분량으로 몇 번 나가는가</div>
              </div>
              {isSide ? (
                <div>
                  <label className="field-label">판매가</label>
                  <div className="muted small" style={{ paddingTop: 10 }}>기본 상차림은 판매가가 없습니다. 원가만 계산합니다.</div>
                </div>
              ) : (
                <div>
                  <label className="field-label">판매가 (1인분)</label>
                  <input className="input" inputMode="numeric" value={draft.salePrice || ""} onChange={(e) => updateDraft("salePrice", toNumber(e.target.value))} placeholder="원" />
                </div>
              )}
            </div>

            <div className="spread" style={{ marginTop: 18, marginBottom: 10 }}>
              <h3 style={{ fontSize: 15 }}>재료 원가</h3>
              <button className="btn btn-soft btn-sm" onClick={addIngredient}>+ 재료 추가</button>
            </div>

            <div className="recipe-ingredient-list">
              {draft.ingredients.map((ingredient) => {
                const unit = normalizeUnit(ingredient.unit);
                const missing = !(Number(ingredient.quantity) > 0) || !(Number(ingredient.unitCost) > 0);
                return (
                  <div className={`recipe-ingredient-row ${missing ? "incomplete" : ""}`} key={ingredient.id}>
                    <div>
                      <label className="field-label">재료명</label>
                      <input className="input" value={ingredient.name} onChange={(e) => updateIngredient(ingredient.id, "name", e.target.value)} placeholder="재료" />
                    </div>
                    <div>
                      <label className="field-label">수량</label>
                      <input className="input" inputMode="decimal" value={ingredient.quantity || ""} onChange={(e) => updateIngredient(ingredient.id, "quantity", toNumber(e.target.value))} placeholder="0" />
                    </div>
                    <div>
                      <label className="field-label">단위</label>
                      <select className="select" value={unit} onChange={(e) => changeUnit(ingredient.id, e.target.value as Unit)}>
                        {UNITS.map((option) => <option key={option} value={option}>{UNIT_LABELS[option]}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="field-label">단가 (원/{unit})</label>
                      <input className="input" inputMode="decimal" value={ingredient.unitCost || ""} onChange={(e) => updateIngredient(ingredient.id, "unitCost", toNumber(e.target.value))} placeholder="원" />
                    </div>
                    <div>
                      <label className="field-label">거래처</label>
                      <select
                        className="select"
                        value={ingredient.vendorId ?? ""}
                        onChange={(e) => updateIngredient(ingredient.id, "vendorId", e.target.value ? Number(e.target.value) : undefined)}
                      >
                        <option value="">미지정</option>
                        {vendors.map((vendor) => (
                          <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="recipe-ingredient-cost">
                      <span className="muted small">소계</span>
                      <strong>{money.format(Math.round((ingredient.quantity || 0) * (ingredient.unitCost || 0)))}원</strong>
                      <button className="btn btn-danger btn-sm" onClick={() => removeIngredient(ingredient.id)}>삭제</button>
                    </div>
                    {/* 엑셀에서 숫자로 못 옮긴 것은 원문을 남겨 두었다 — 사장님이 보고 채운다 */}
                    {ingredient.note && (
                      <div className="recipe-ingredient-note muted small">
                        {ingredient.note}
                        <button className="text-button" style={{ marginLeft: 8 }} onClick={() => updateIngredient(ingredient.id, "note", undefined)}>지우기</button>
                      </div>
                    )}
                  </div>
                );
              })}
              {draft.ingredients.length === 0 && (
                <button className="btn btn-outline btn-block" onClick={addIngredient}>재료를 추가해 원가계산을 시작하세요</button>
              )}
            </div>

            <div style={{ marginTop: 14 }}>
              <label className="field-label">조리 메모</label>
              <textarea className="textarea" value={draft.memo ?? ""} onChange={(e) => updateDraft("memo", e.target.value)} placeholder="소스 배합, 조리 순서, 보관 팁" />
            </div>

            <div className="row" style={{ justifyContent: "flex-end", marginTop: 16, flexWrap: "wrap" }}>
              <button className="btn btn-outline" onClick={resetForm}>취소</button>
              <button className="btn btn-primary" onClick={saveRecipe}>{editingId ? "수정 저장" : "레시피 등록"}</button>
            </div>
          </Card>
        </div>

        <div className="stack side-panel">
          <Card title="원가계산 결과" icon="🧮">
            <div className="pay-line">
              <span className="k">재료 원가 (전체)</span>
              <span className="v">{money.format(Math.round(totals.totalCost))}원</span>
            </div>
            <div className="pay-line total">
              <span className="k">{isSide ? "1회 제공 원가" : "1인분 원가"}</span>
              <span className="v">{money.format(Math.round(totals.perServingCost))}원</span>
            </div>
            {isSide ? (
              <p className="muted small" style={{ marginTop: 10 }}>
                기본 상차림은 판매가가 없어 원가율을 내지 않습니다. 1회 제공 원가로 보세요.
              </p>
            ) : (
              <>
                <div className="pay-line">
                  <span className="k">판매가</span>
                  <span className="v">{totals.salePrice ? `${money.format(totals.salePrice)}원` : "—"}</span>
                </div>
                <div className={`pay-line total ${totals.costRate !== null && totals.costRate > 40 ? "minus" : ""}`}>
                  <span className="k">원가율</span>
                  <span className="v">{costRateText(totals.costRate)}</span>
                </div>
                <div className="row" style={{ marginTop: 10, justifyContent: "space-between" }}>
                  <Badge tone={costTone(totals.costRate)}>
                    {totals.costRate === null ? "판매가 없음" : totals.costRate <= 30 ? "원가율 좋음" : totals.costRate <= 40 ? "원가율 보통" : "원가율 높음"}
                  </Badge>
                  <span className="muted small">30% 이하 좋음 · 40% 넘으면 확인</span>
                </div>
              </>
            )}
            {totals.incomplete > 0 && (
              <p className="muted small" style={{ marginTop: 10, color: "var(--red-tx)" }}>
                수량이나 단가가 빈 재료가 {totals.incomplete}개 있습니다. 채우기 전까지 원가는 실제보다 작습니다.
              </p>
            )}
          </Card>
        </div>
      </div>

      <Card
        title="판매 메뉴"
        icon="🍖"
        action={
          <input
            className="input"
            style={{ width: 240 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="레시피·재료 검색"
          />
        }
      >
        <div className="table-wrap">
          <table className="table recipe-table">
            <thead>
              <tr>
                <th>레시피</th>
                <th>분류</th>
                <th>재료</th>
                <th className="num">재료 원가</th>
                <th className="num">1인분</th>
                <th className="num">판매가</th>
                <th>원가율</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {menuRecipes.map((recipe) => {
                const cost = recipeCost(recipe);
                return (
                  <tr key={recipe.id}>
                    <td className="bold">
                      {recipe.name}
                      {cost.incomplete > 0 && <div><Badge tone="amber">확인 필요 {cost.incomplete}</Badge></div>}
                    </td>
                    <td>{recipe.category || "-"}</td>
                    <td>{renderIngredientCell(recipe)}</td>
                    <td className="num">{money.format(Math.round(cost.totalCost))}원</td>
                    <td className="num">{money.format(Math.round(cost.perServingCost))}원</td>
                    <td className="num">{cost.salePrice ? `${money.format(cost.salePrice)}원` : <span className="muted">미입력</span>}</td>
                    <td><Badge tone={costTone(cost.costRate)}>{costRateText(cost.costRate)}</Badge></td>
                    <td>{renderActions(recipe)}</td>
                  </tr>
                );
              })}
              {menuRecipes.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted" style={{ textAlign: "center", padding: 24 }}>
                    등록된 판매 메뉴가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="기본 상차림 · 소스" icon="🥗">
        <div className="table-wrap">
          <table className="table recipe-table">
            <thead>
              <tr>
                <th>레시피</th>
                <th>분류</th>
                <th>재료</th>
                <th className="num">재료 원가</th>
                <th className="num">1회 제공</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {sideRecipes.map((recipe) => {
                const cost = recipeCost(recipe);
                return (
                  <tr key={recipe.id}>
                    <td className="bold">
                      {recipe.name}
                      {cost.incomplete > 0 && <div><Badge tone="amber">확인 필요 {cost.incomplete}</Badge></div>}
                    </td>
                    <td>{recipe.category || "-"}</td>
                    <td>{renderIngredientCell(recipe)}</td>
                    <td className="num">{money.format(Math.round(cost.totalCost))}원</td>
                    <td className="num">{money.format(Math.round(cost.perServingCost))}원</td>
                    <td>{renderActions(recipe)}</td>
                  </tr>
                );
              })}
              {sideRecipes.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>
                    등록된 기본 상차림이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
