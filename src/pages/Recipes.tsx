import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Badge, Card, StatCard } from "../components/ui";
import type { Recipe, RecipeIngredient } from "../data/types";

const money = new Intl.NumberFormat("ko-KR");

const EMPTY_RECIPE: Recipe = {
  id: 0,
  name: "",
  category: "",
  servings: 1,
  ingredients: [],
  laborCost: 0,
  overheadCost: 0,
  salePrice: 0,
  memo: "",
  active: true,
};

function makeIngredient(): RecipeIngredient {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()),
    name: "",
    quantity: 1,
    unit: "개",
    unitCost: 0,
  };
}

function nextRecipeId(recipes: Recipe[]): number {
  return Math.max(0, ...recipes.map((recipe) => recipe.id)) + 1;
}

function recipeCost(recipe: Recipe) {
  const ingredientCost = recipe.ingredients.reduce(
    (sum, ingredient) => sum + (Number(ingredient.quantity) || 0) * (Number(ingredient.unitCost) || 0),
    0
  );
  const laborCost = Number(recipe.laborCost) || 0;
  const overheadCost = Number(recipe.overheadCost) || 0;
  const salePrice = Number(recipe.salePrice) || 0;
  const servings = Math.max(1, Number(recipe.servings) || 1);
  const totalCost = ingredientCost + laborCost + overheadCost;
  const perServingCost = totalCost / servings;
  const margin = salePrice - totalCost;
  const marginRate = salePrice > 0 ? (margin / salePrice) * 100 : 0;
  return { ingredientCost, laborCost, overheadCost, totalCost, perServingCost, salePrice, margin, marginRate };
}

function toNumber(value: string): number {
  return Number(value.replace(/[^0-9.]/g, "")) || 0;
}

export default function Recipes() {
  const { recipes, vendors, upsertRecipe, deleteRecipe, showToast } = useStore();
  const [draft, setDraft] = useState<Recipe>(EMPTY_RECIPE);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  const totals = useMemo(() => recipeCost(draft), [draft]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recipes;
    return recipes.filter((recipe) =>
      [recipe.name, recipe.category, recipe.memo]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [query, recipes]);

  const averageCost = recipes.length
    ? recipes.reduce((sum, recipe) => sum + recipeCost(recipe).totalCost, 0) / recipes.length
    : 0;

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

  const addIngredient = () => {
    setDraft((prev) => ({ ...prev, ingredients: [...prev.ingredients, makeIngredient()] }));
  };

  const removeIngredient = (id: string) => {
    setDraft((prev) => ({ ...prev, ingredients: prev.ingredients.filter((ingredient) => ingredient.id !== id) }));
  };

  const resetForm = () => {
    setDraft(EMPTY_RECIPE);
    setEditingId(null);
  };

  const editRecipe = (recipe: Recipe) => {
    setDraft({
      ...recipe,
      ingredients: recipe.ingredients.length ? recipe.ingredients.map((ingredient) => ({ ...ingredient })) : [],
    });
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
        unit: ingredient.unit.trim() || "개",
        quantity: Number(ingredient.quantity) || 0,
        unitCost: Number(ingredient.unitCost) || 0,
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
      servings: Math.max(1, Number(draft.servings) || 1),
      ingredients,
      laborCost: Number(draft.laborCost) || 0,
      overheadCost: Number(draft.overheadCost) || 0,
      salePrice: Number(draft.salePrice) || 0,
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

  return (
    <>
      <div className="grid grid-4">
        <StatCard label="등록 레시피" value={recipes.length} unit="개" trend="원가계산 포함" trendUp icon="🥘" />
        <StatCard label="평균 총원가" value={money.format(Math.round(averageCost))} unit="원" trend="레시피 기준" trendUp icon="🧾" tone="blue" />
        <StatCard label="현재 총원가" value={money.format(Math.round(totals.totalCost))} unit="원" trend="작성 중 레시피" trendUp icon="💰" tone="amber" />
        <StatCard label="현재 마진율" value={`${totals.marginRate.toFixed(1)}`} unit="%" trend="판매가 대비" trendUp={totals.margin >= 0} icon="📈" />
      </div>

      <div className="grid grid-main-side">
        <div className="stack">
          <Card
            title={editingId ? "레시피 수정" : "레시피 등록"}
            icon="🥘"
            action={editingId ? <button className="btn btn-outline btn-sm" onClick={resetForm}>새 레시피</button> : undefined}
          >
            <div className="grid grid-4" style={{ gap: 12 }}>
              <div>
                <label className="field-label">레시피명</label>
                <input className="input" value={draft.name} onChange={(e) => updateDraft("name", e.target.value)} placeholder="예: 김치찌개" />
              </div>
              <div>
                <label className="field-label">분류</label>
                <input className="input" value={draft.category} onChange={(e) => updateDraft("category", e.target.value)} placeholder="찌개, 구이, 반찬" />
              </div>
              <div>
                <label className="field-label">기준 인분</label>
                <input className="input" inputMode="numeric" value={draft.servings} onChange={(e) => updateDraft("servings", toNumber(e.target.value))} />
              </div>
              <div>
                <label className="field-label">판매가</label>
                <input className="input" inputMode="numeric" value={draft.salePrice || ""} onChange={(e) => updateDraft("salePrice", toNumber(e.target.value))} placeholder="원" />
              </div>
            </div>

            <div className="grid grid-2" style={{ gap: 12, marginTop: 14 }}>
              <div>
                <label className="field-label">인건비 배분</label>
                <input className="input" inputMode="numeric" value={draft.laborCost || ""} onChange={(e) => updateDraft("laborCost", toNumber(e.target.value))} placeholder="원" />
              </div>
              <div>
                <label className="field-label">운영비 배분</label>
                <input className="input" inputMode="numeric" value={draft.overheadCost || ""} onChange={(e) => updateDraft("overheadCost", toNumber(e.target.value))} placeholder="가스/포장/기타" />
              </div>
            </div>

            <div className="spread" style={{ marginTop: 18, marginBottom: 10 }}>
              <h3 style={{ fontSize: 15 }}>재료 원가</h3>
              <button className="btn btn-soft btn-sm" onClick={addIngredient}>+ 재료 추가</button>
            </div>

            <div className="recipe-ingredient-list">
              {draft.ingredients.map((ingredient) => (
                <div className="recipe-ingredient-row" key={ingredient.id}>
                  <div>
                    <label className="field-label">재료명</label>
                    <input className="input" value={ingredient.name} onChange={(e) => updateIngredient(ingredient.id, "name", e.target.value)} placeholder="재료" />
                  </div>
                  <div>
                    <label className="field-label">수량</label>
                    <input className="input" inputMode="decimal" value={ingredient.quantity || ""} onChange={(e) => updateIngredient(ingredient.id, "quantity", toNumber(e.target.value))} />
                  </div>
                  <div>
                    <label className="field-label">단위</label>
                    <input className="input" value={ingredient.unit} onChange={(e) => updateIngredient(ingredient.id, "unit", e.target.value)} placeholder="kg" />
                  </div>
                  <div>
                    <label className="field-label">단가</label>
                    <input className="input" inputMode="numeric" value={ingredient.unitCost || ""} onChange={(e) => updateIngredient(ingredient.id, "unitCost", toNumber(e.target.value))} placeholder="원" />
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
                </div>
              ))}
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
              <span className="k">재료 원가</span>
              <span className="v">{money.format(Math.round(totals.ingredientCost))}원</span>
            </div>
            <div className="pay-line">
              <span className="k">인건비</span>
              <span className="v">{money.format(Math.round(totals.laborCost))}원</span>
            </div>
            <div className="pay-line">
              <span className="k">운영비</span>
              <span className="v">{money.format(Math.round(totals.overheadCost))}원</span>
            </div>
            <div className="pay-line total">
              <span className="k">총원가</span>
              <span className="v">{money.format(Math.round(totals.totalCost))}원</span>
            </div>
            <div className="pay-line">
              <span className="k">1인분 원가</span>
              <span className="v">{money.format(Math.round(totals.perServingCost))}원</span>
            </div>
            <div className={`pay-line total ${totals.margin < 0 ? "minus" : ""}`}>
              <span className="k">예상 마진</span>
              <span className="v">{money.format(Math.round(totals.margin))}원</span>
            </div>
            <div className="row" style={{ marginTop: 10, justifyContent: "space-between" }}>
              <Badge tone={totals.marginRate >= 30 ? "green" : totals.marginRate >= 10 ? "amber" : "red"}>
                마진율 {totals.marginRate.toFixed(1)}%
              </Badge>
              <span className="muted small">판매가 {money.format(totals.salePrice)}원</span>
            </div>
          </Card>
        </div>
      </div>

      <Card
        title="레시피 목록"
        icon="📚"
        action={
          <input
            className="input"
            style={{ width: 240 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="레시피 검색"
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
                <th>총원가</th>
                <th>1인분</th>
                <th>판매가</th>
                <th>마진율</th>
                <th>관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((recipe) => {
                const cost = recipeCost(recipe);
                return (
                  <tr key={recipe.id}>
                    <td className="bold">{recipe.name}</td>
                    <td>{recipe.category || "-"}</td>
                    <td>
                      {recipe.ingredients.slice(0, 3).map((ingredient) => (
                        <div className="muted small" key={ingredient.id}>
                          {ingredient.name} · {vendorName(ingredient.vendorId)}
                        </div>
                      ))}
                      {recipe.ingredients.length > 3 && <div className="muted small">외 {recipe.ingredients.length - 3}개</div>}
                    </td>
                    <td className="num">{money.format(Math.round(cost.totalCost))}원</td>
                    <td className="num">{money.format(Math.round(cost.perServingCost))}원</td>
                    <td className="num">{money.format(recipe.salePrice)}원</td>
                    <td><Badge tone={cost.marginRate >= 30 ? "green" : cost.marginRate >= 10 ? "amber" : "red"}>{cost.marginRate.toFixed(1)}%</Badge></td>
                    <td>
                      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                        <button className="btn btn-outline btn-sm" onClick={() => editRecipe(recipe)}>수정</button>
                        <button className="btn btn-danger btn-sm" onClick={() => removeRecipe(recipe)}>삭제</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted" style={{ textAlign: "center", padding: 24 }}>
                    등록된 레시피가 없습니다.
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
