import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { Badge, Card } from "../components/ui";
import type { Recipe, RecipeIngredient, RecipeKind } from "../data/types";
import { UNITS, UNIT_LABELS, type Unit, convertQuantity, convertUnitCost, normalizeUnit } from "../data/units";
import {
  BATCH_UNIT, convertSubQuantity, createRecipeCoster, hasYield, isSubRecipeRow, recipesUsing,
  unitsForSubRecipe, usableSubRecipes, yieldText, type RecipeCost,
} from "../lib/recipeCost";

/*
  레시피 원가 — 휴대폰이 먼저다.

  목록은 표가 아니라 카드다. 여덟 칸짜리 표는 휴대폰에서 옆으로 밀어야 하고,
  사장님은 «돼지갈비 원가율 몇 %»만 보면 된다. 카드를 누르면 모달에서 고친다.

  **원가율만 본다.** 인건비·운영비 배분은 없다. 판매 메뉴와 기본 상차림을 갈라서,
  판매가 없는 상차림이 «원가율 0%»로 보이지 않게 한다.

  **레시피 안에 레시피를 넣는다.** 된장찌개 = 된장육수 300ml + 두부 + 고기. 육수 줄의
  단가는 손으로 적지 않고 된장육수 원가 ÷ 산출량(2L)으로 계산한다 — 계산은
  src/lib/recipeCost.ts 에 있고, 그래서 원가는 언제나 레시피 목록 전체를 보고 낸다.
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
    quantity: 0,
    unit: "kg",
    unitCost: 0,
  };
}

/** 하위 레시피 줄 — 「+ 레시피 넣기」를 누른 직후엔 아직 고른 레시피가 없다(0). */
function makeSubRecipeRow(): RecipeIngredient {
  return { ...makeIngredient(), unit: BATCH_UNIT, subRecipeId: 0 };
}

/** «회분»은 하위 레시피 줄에만 있는 단위라 단위표로 맞추면 ea 가 돼 버린다 */
function rowUnit(ingredient: RecipeIngredient): string {
  return isSubRecipeRow(ingredient) && ingredient.unit === BATCH_UNIT ? BATCH_UNIT : normalizeUnit(ingredient.unit);
}

/** 산출량 단위. 박스로 나오는 육수는 없다. */
const YIELD_UNITS: Unit[] = ["ml", "L", "g", "kg", "ea"];

function nextRecipeId(recipes: Recipe[]): number {
  return Math.max(0, ...recipes.map((recipe) => recipe.id)) + 1;
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

function won(value: number): string {
  return `${money.format(Math.round(value))}원`;
}

/** ml 당 6.2원처럼 작은 단가는 소수점까지 보여 준다 — 반올림하면 6원이 돼 계산이 안 맞아 보인다 */
function unitWon(value: number): string {
  if (value >= 100) return won(value);
  return `${Number(value.toFixed(2)).toLocaleString("ko-KR")}원`;
}

/** 수량 표기: 0.0633kg → "0.063kg", 3.75kg → "3.75kg" */
function qtyText(ingredient: RecipeIngredient): string {
  const quantity = Number(ingredient.quantity) || 0;
  if (quantity <= 0) return "";
  const text = quantity >= 100 ? String(Math.round(quantity)) : String(Number(quantity.toFixed(3)));
  return `${text}${normalizeUnit(ingredient.unit)}`;
}

/* ============================================================
   목록 카드
   ============================================================ */

function RecipeCard({ recipe, cost, onOpen }: { recipe: Recipe; cost: RecipeCost; onOpen: (recipe: Recipe) => void }) {
  const isSide = recipe.kind === "side";
  const preview = recipe.ingredients.slice(0, 4).map((ingredient) => ingredient.name).join(" · ");
  const more = recipe.ingredients.length - 4;
  return (
    <button type="button" className="recipe-card" onClick={() => onOpen(recipe)}>
      <div className="recipe-card-top">
        <div className="recipe-card-title">
          <strong>{recipe.name}</strong>
          {recipe.category && <span className="recipe-card-cat">{recipe.category}</span>}
        </div>
        {isSide ? (
          <span className="recipe-card-rate muted">원가만</span>
        ) : (
          <span className={`recipe-card-rate ${costTone(cost.costRate)}`}>
            {cost.costRate === null ? "판매가 없음" : costRateText(cost.costRate)}
          </span>
        )}
      </div>
      <div className="recipe-card-nums">
        <span><em>{isSide ? "1회 원가" : "1인분 원가"}</em>{won(cost.perServingCost)}</span>
        {!isSide && <span><em>판매가</em>{cost.salePrice ? won(cost.salePrice) : "—"}</span>}
        <span><em>재료 전체</em>{won(cost.totalCost)}</span>
        {hasYield(recipe) && <span><em>산출량</em>{yieldText(recipe)}</span>}
      </div>
      <div className="recipe-card-foot">
        <span className="muted small recipe-card-preview">
          {preview || "재료 없음"}{more > 0 ? ` 외 ${more}` : ""}
        </span>
        {cost.incomplete > 0 && <Badge tone="amber">확인 필요 {cost.incomplete}</Badge>}
      </div>
    </button>
  );
}

/* ============================================================
   편집 모달
   ============================================================ */

function RecipeEditor({
  initial, recipes, categories, vendors, onSave, onDelete, onClose,
}: {
  initial: Recipe;
  /** 저장된 레시피 전체 — 하위 레시피를 고르고 원가를 풀려면 필요하다 */
  recipes: Recipe[];
  categories: string[];
  vendors: { id: number; name: string }[];
  onSave: (recipe: Recipe) => void;
  onDelete?: (recipe: Recipe) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Recipe>(() => ({
    ...initial,
    kind: initial.kind === "side" ? "side" : "menu",
    yieldQuantity: Number(initial.yieldQuantity) || 0,
    // 단위 칸은 늘 무언가 골라져 보인다. 수량이 0 이면 저장할 때 산출량 없음으로 지운다.
    yieldUnit: initial.yieldUnit || "L",
    ingredients: initial.ingredients.map((ingredient) => ({ ...ingredient, unit: rowUnit(ingredient) })),
  }));
  const [customCategory, setCustomCategory] = useState(
    Boolean(initial.category) && !categories.includes(initial.category)
  );
  const [error, setError] = useState<string | null>(null);
  const isEditing = initial.id > 0;
  const isSide = draft.kind === "side";
  const coster = useMemo(() => createRecipeCoster(recipes), [recipes]);
  const totals = useMemo(() => coster.recipe(draft), [coster, draft]);
  const byId = useMemo(() => new Map(recipes.map((recipe) => [recipe.id, recipe])), [recipes]);
  // 육수·소스가 먼저 — 넣는 것은 대개 그쪽이다
  const candidates = useMemo(
    () => usableSubRecipes(recipes, draft.id).sort((a, b) =>
      Number(b.category === "육수·소스") - Number(a.category === "육수·소스") || a.name.localeCompare(b.name, "ko")),
    [recipes, draft.id],
  );
  const usedBy = useMemo(() => (draft.id > 0 ? recipesUsing(recipes, draft.id) : []), [recipes, draft.id]);

  // 모달이 열린 동안 뒤 화면은 안 움직인다. Esc 로 닫는다.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const updateDraft = <K extends keyof Recipe>(key: K, value: Recipe[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const updateIngredient = <K extends keyof RecipeIngredient>(id: string, key: K, value: RecipeIngredient[K]) => {
    setDraft((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ingredient) => (ingredient.id === id ? { ...ingredient, [key]: value } : ingredient)),
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

  const addSubRecipe = () => {
    setDraft((prev) => ({ ...prev, ingredients: [...prev.ingredients, makeSubRecipeRow()] }));
  };

  /** 레시피를 고르면 단위를 그 레시피 산출량 계열로 맞춘다 — 2L 육수면 ml, 산출량이 없으면 회분 */
  const pickSubRecipe = (id: string, subId: number) => {
    const sub = byId.get(subId);
    setDraft((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ingredient) => {
        if (ingredient.id !== id) return ingredient;
        const allowed = unitsForSubRecipe(sub);
        // 이미 ml·g 를 골라 뒀으면 그대로, 아니면(회분 포함) 산출량 계열의 첫 단위로 — ml·g 가 기본이다
        const current = String(ingredient.unit);
        const unit = current !== BATCH_UNIT && allowed.includes(current) ? current : allowed[0];
        return { ...ingredient, subRecipeId: subId, name: sub?.name ?? "", unit, unitCost: 0, vendorId: undefined };
      }),
    }));
  };

  /** ml ↔ L 처럼 같은 계열이면 양을 그대로 옮긴다 (0.3L → 300ml) */
  const changeSubUnit = (id: string, next: string) => {
    setDraft((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((ingredient) => {
        if (ingredient.id !== id) return ingredient;
        const quantity = convertSubQuantity(Number(ingredient.quantity) || 0, String(ingredient.unit), next);
        return { ...ingredient, unit: next, quantity: Number(quantity.toFixed(4)) };
      }),
    }));
  };

  const removeIngredient = (id: string) => {
    setDraft((prev) => ({ ...prev, ingredients: prev.ingredients.filter((ingredient) => ingredient.id !== id) }));
  };

  const save = () => {
    const name = draft.name.trim();
    if (!name) { setError("레시피명을 적어 주세요."); return; }
    const ingredients: RecipeIngredient[] = draft.ingredients
      .map((ingredient): RecipeIngredient => {
        if (isSubRecipeRow(ingredient)) {
          const sub = byId.get(Number(ingredient.subRecipeId));
          return {
            id: ingredient.id,
            name: sub?.name ?? ingredient.name.trim(),
            quantity: Number(ingredient.quantity) || 0,
            unit: String(ingredient.unit),
            // 화면은 늘 다시 계산한다. 저장값은 카톡 챗봇처럼 이 계산을 모르는 곳을 위한 스냅숏이다.
            unitCost: Number(coster.ingredient(ingredient, draft).unitCost.toFixed(4)),
            subRecipeId: Number(ingredient.subRecipeId) || 0,
          };
        }
        return {
          ...ingredient,
          name: ingredient.name.trim(),
          unit: normalizeUnit(ingredient.unit),
          quantity: Number(ingredient.quantity) || 0,
          unitCost: Number(ingredient.unitCost) || 0,
          note: ingredient.note?.trim() || undefined,
        };
      })
      // 이름 없는 줄, 레시피를 안 고른 «레시피 넣기» 줄은 버린다
      .filter((ingredient) => ingredient.name && (!isSubRecipeRow(ingredient) || Number(ingredient.subRecipeId) > 0));
    if (ingredients.length === 0) { setError("재료를 1개 이상 넣어 주세요."); return; }
    const yieldQuantity = Number(draft.yieldQuantity) || 0;
    onSave({
      ...draft,
      name,
      category: draft.category.trim(),
      kind: isSide ? "side" : "menu",
      servings: Math.max(1, Number(draft.servings) || 1),
      // 0 과 빈 문자열로 «없음»을 적는다 — merge 저장이라 undefined 로는 예전 값이 안 지워진다
      yieldQuantity: yieldQuantity > 0 ? yieldQuantity : 0,
      yieldUnit: yieldQuantity > 0 ? normalizeUnit(draft.yieldUnit) : "",
      ingredients,
      salePrice: isSide ? 0 : Number(draft.salePrice) || 0,
      memo: draft.memo?.trim(),
      active: true,
      createdAt: draft.createdAt ?? new Date().toISOString(),
    });
  };

  const categorySelectValue = customCategory ? CUSTOM_CATEGORY : (draft.category || "");

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section className="modal-panel recipe-modal" role="dialog" aria-modal="true" aria-labelledby="recipe-modal-title">
        <div className="modal-head">
          <div>
            <h2 id="recipe-modal-title">{isEditing ? draft.name || "레시피 수정" : "레시피 등록"}</h2>
            <p>{isSide ? "기본 상차림은 판매가 없이 원가만 봅니다." : "재료비 ÷ 판매가 = 원가율. 30% 이하가 좋습니다."}</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="닫기">×</button>
        </div>

        <div className="modal-body recipe-modal-body">
          {/* 판매 메뉴인지 상차림인지가 먼저다 — 그에 따라 판매가 칸이 있고 없다 */}
          <div className="segmented fill" role="tablist" aria-label="레시피 종류">
            {(["menu", "side"] as RecipeKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                role="tab"
                aria-selected={draft.kind === kind}
                className={draft.kind === kind ? "on" : ""}
                onClick={() => updateDraft("kind", kind)}
              >
                {KIND_LABEL[kind]}
              </button>
            ))}
          </div>

          <div className="recipe-form-grid">
            <div className="recipe-form-wide">
              <label className="field-label">레시피명</label>
              <input className="input" value={draft.name} onChange={(e) => updateDraft("name", e.target.value)} placeholder={isSide ? "예: 겉절이" : "예: 돼지갈비"} autoFocus={!isEditing} />
            </div>
            <div>
              <label className="field-label">분류</label>
              <select
                className="select"
                value={categorySelectValue}
                onChange={(e) => {
                  if (e.target.value === CUSTOM_CATEGORY) { setCustomCategory(true); updateDraft("category", ""); }
                  else { setCustomCategory(false); updateDraft("category", e.target.value); }
                }}
              >
                <option value="">분류 선택</option>
                {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                <option value={CUSTOM_CATEGORY}>+ 직접 입력</option>
              </select>
              {customCategory && (
                <input className="input" style={{ marginTop: 6 }} value={draft.category} onChange={(e) => updateDraft("category", e.target.value)} placeholder="새 분류 이름" />
              )}
            </div>
            <div>
              <label className="field-label">{isSide ? "제공 횟수" : "기준 인분"}</label>
              <input className="input" inputMode="numeric" value={draft.servings || ""} onChange={(e) => updateDraft("servings", toNumber(e.target.value))} placeholder="1" />
              <div className="muted small field-hint">이 재료 분량으로 몇 번 나가는가</div>
            </div>
            {!isSide && (
              <div>
                <label className="field-label">판매가 (1인분)</label>
                <input className="input" inputMode="numeric" value={draft.salePrice || ""} onChange={(e) => updateDraft("salePrice", toNumber(e.target.value))} placeholder="원" />
              </div>
            )}
            <div>
              <label className="field-label">산출량 <span className="muted">(선택)</span></label>
              <div className="ri-yield">
                <input className="input" inputMode="decimal" value={draft.yieldQuantity || ""} onChange={(e) => updateDraft("yieldQuantity", toNumber(e.target.value))} placeholder="예: 2" aria-label="산출량" />
                <select className="select" value={draft.yieldUnit || "L"} onChange={(e) => updateDraft("yieldUnit", e.target.value)} aria-label="산출량 단위">
                  {YIELD_UNITS.map((option) => <option key={option} value={option}>{UNIT_LABELS[option]}</option>)}
                </select>
              </div>
              <div className="muted small field-hint">한 번 만들면 나오는 양. 육수·소스처럼 다른 레시피에 ml·g로 넣을 때 씁니다</div>
            </div>
          </div>

          {/* 이 레시피를 고치면 품고 있는 레시피 원가도 같이 움직인다 — 그걸 고치기 전에 알아야 한다 */}
          {usedBy.length > 0 && (
            <p className="recipe-used-by">
              이 레시피는 {usedBy.map((recipe) => `「${recipe.name}」`).join(" ")}에 재료로 들어갑니다.
              재료나 산출량을 고치면 그 레시피 원가도 같이 바뀝니다.
            </p>
          )}

          <div className="spread recipe-section-head">
            <div className="modal-section-title" style={{ margin: 0 }}>재료 {draft.ingredients.length > 0 ? `${draft.ingredients.length}개` : ""}</div>
            <div className="ri-head-actions">
              <button
                className="btn btn-soft btn-sm"
                type="button"
                onClick={addSubRecipe}
                disabled={candidates.length === 0}
                title={candidates.length === 0 ? "넣을 수 있는 다른 레시피가 없습니다" : undefined}
              >
                + 레시피 넣기
              </button>
              <button className="btn btn-soft btn-sm" type="button" onClick={addIngredient}>+ 재료 추가</button>
            </div>
          </div>

          <div className="ri-list">
            {draft.ingredients.map((ingredient, index) => {
              if (isSubRecipeRow(ingredient)) {
                const subId = Number(ingredient.subRecipeId) || 0;
                const sub = byId.get(subId);
                const cost = coster.ingredient(ingredient, draft);
                const current = String(ingredient.unit);
                const allowed = unitsForSubRecipe(sub);
                // 산출량을 바꾸거나 지워서 지금 단위가 목록에서 빠졌으면, 그 단위도 보여 주고 다시 고르게 한다
                const unitOptions = allowed.includes(current) ? allowed : [current, ...allowed];
                // 지금 고른 레시피는 (순환 등으로 후보에서 빠졌어도) 목록에 남겨야 화면이 비지 않는다
                const pickable = sub && !candidates.some((candidate) => candidate.id === sub.id) ? [sub, ...candidates] : candidates;
                const subTotal = sub ? coster.recipe(sub).totalCost : 0;
                const broken = Boolean(cost.issue) && cost.issue?.kind !== "sub-incomplete";
                return (
                  <div className={`ri-card ri-sub ${cost.incomplete ? "incomplete" : ""}`} key={ingredient.id}>
                    <div className="ri-name-row">
                      <span className="ri-index">{index + 1}</span>
                      <span className="ri-sub-tag">레시피</span>
                      <select
                        className="select ri-sub-pick"
                        value={subId || ""}
                        onChange={(e) => pickSubRecipe(ingredient.id, Number(e.target.value))}
                        aria-label="넣을 레시피"
                      >
                        <option value="">레시피 고르기</option>
                        {pickable.map((recipe) => (
                          <option key={recipe.id} value={recipe.id}>
                            {recipe.name}{hasYield(recipe) ? ` · ${yieldText(recipe)}` : ""}
                          </option>
                        ))}
                      </select>
                      <button className="icon-btn ri-remove" type="button" aria-label="재료 삭제" onClick={() => removeIngredient(ingredient.id)}>×</button>
                    </div>
                    <div className="ri-grid">
                      <div>
                        <label className="field-label">얼마나</label>
                        <input className="input" inputMode="decimal" value={ingredient.quantity || ""} onChange={(e) => updateIngredient(ingredient.id, "quantity", toNumber(e.target.value))} placeholder="0" />
                      </div>
                      <div>
                        <label className="field-label">단위</label>
                        <select className="select" value={current} onChange={(e) => changeSubUnit(ingredient.id, e.target.value)}>
                          {unitOptions.map((option) => (
                            <option key={option} value={option}>
                              {option === BATCH_UNIT ? "회분 (한 번 만든 양)" : UNIT_LABELS[option as Unit] ?? option}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="field-label">단가 (자동)</label>
                        <div className="input ri-auto-cost">
                          {broken || !sub ? "—" : current === BATCH_UNIT ? `1회분 ${won(cost.unitCost)}` : `${unitWon(cost.unitCost)}/${current}`}
                        </div>
                      </div>
                    </div>
                    <div className="ri-foot">
                      <span className="muted small">
                        {sub ? (hasYield(sub) ? `${sub.name} ${yieldText(sub)} = ${won(subTotal)}` : `${sub.name} 1회분 = ${won(subTotal)} · 산출량 미입력`) : ""}
                      </span>
                      <span className="ri-subtotal">
                        {broken ? <span className="muted">계산 안 됨</span> : !(Number(ingredient.quantity) > 0) ? <span className="muted">양 필요</span> : won(cost.subtotal)}
                      </span>
                    </div>
                    {cost.issue && <div className="ri-issue" role="note">{cost.issue.message}</div>}
                  </div>
                );
              }

              const unit = normalizeUnit(ingredient.unit);
              const missing = !(Number(ingredient.quantity) > 0) || !(Number(ingredient.unitCost) > 0);
              const subtotal = (Number(ingredient.quantity) || 0) * (Number(ingredient.unitCost) || 0);
              return (
                <div className={`ri-card ${missing ? "incomplete" : ""}`} key={ingredient.id}>
                  <div className="ri-name-row">
                    <span className="ri-index">{index + 1}</span>
                    <input className="input" value={ingredient.name} onChange={(e) => updateIngredient(ingredient.id, "name", e.target.value)} placeholder="재료명" />
                    <button className="icon-btn ri-remove" type="button" aria-label="재료 삭제" onClick={() => removeIngredient(ingredient.id)}>×</button>
                  </div>
                  <div className="ri-grid">
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
                  </div>
                  <div className="ri-foot">
                    <select
                      className="select ri-vendor"
                      value={ingredient.vendorId ?? ""}
                      onChange={(e) => updateIngredient(ingredient.id, "vendorId", e.target.value ? Number(e.target.value) : undefined)}
                      aria-label="거래처"
                    >
                      <option value="">거래처 미지정</option>
                      {vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
                    </select>
                    <span className="ri-subtotal">{missing ? <span className="muted">수량·단가 필요</span> : won(subtotal)}</span>
                  </div>
                  {/* 엑셀에서 숫자로 못 옮긴 것은 원문을 남겨 두었다 — 보고 채운 뒤 지운다 */}
                  {ingredient.note && (
                    <div className="ri-note muted small">
                      {ingredient.note}
                      <button className="text-button" type="button" onClick={() => updateIngredient(ingredient.id, "note", undefined)}>지우기</button>
                    </div>
                  )}
                </div>
              );
            })}
            {draft.ingredients.length === 0 && (
              <button className="btn btn-outline btn-block" type="button" onClick={addIngredient}>재료를 추가해 원가계산을 시작하세요</button>
            )}
          </div>

          <div style={{ marginTop: 14 }}>
            <label className="field-label">메모</label>
            <textarea className="textarea" value={draft.memo ?? ""} onChange={(e) => updateDraft("memo", e.target.value)} placeholder="소스 배합, 조리 순서, 보관 팁" rows={2} />
          </div>

          {error && <p className="recipe-error" role="alert">{error}</p>}
        </div>

        {/* 원가 요약은 늘 보인다 — 재료를 고치면 여기 숫자가 바로 움직인다 */}
        <div className="recipe-modal-foot">
          <div className="recipe-summary">
            <div>
              <span className="muted small">{isSide ? "1회 제공 원가" : "1인분 원가"}</span>
              <strong>{won(totals.perServingCost)}</strong>
            </div>
            <div>
              <span className="muted small">재료 전체</span>
              <strong>{won(totals.totalCost)}</strong>
            </div>
            {!isSide && (
              <div>
                <span className="muted small">원가율</span>
                <strong className={`recipe-rate ${costTone(totals.costRate)}`}>{costRateText(totals.costRate)}</strong>
              </div>
            )}
            {totals.incomplete > 0 && (
              <div className="recipe-summary-warn">확인이 필요한 줄 {totals.incomplete}개 — 원가가 실제보다 작습니다</div>
            )}
          </div>
          <div className="recipe-modal-actions">
            {isEditing && onDelete && (
              <button className="btn btn-danger" type="button" onClick={() => onDelete(draft)}>삭제</button>
            )}
            <button className="btn btn-outline" type="button" onClick={onClose}>취소</button>
            <button className="btn btn-primary" type="button" onClick={save}>{isEditing ? "저장" : "등록"}</button>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ============================================================
   페이지
   ============================================================ */

export default function Recipes() {
  const { recipes, vendors, upsertRecipe, deleteRecipe, showToast } = useStore();
  const [kind, setKind] = useState<RecipeKind>("menu");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("전체");
  const [editing, setEditing] = useState<Recipe | null>(null);

  const categories = useMemo(() => {
    const names = new Set<string>(PRESET_CATEGORIES);
    recipes.forEach((recipe) => { if (recipe.category) names.add(recipe.category); });
    return [...names];
  }, [recipes]);

  const ofKind = useMemo(
    () => recipes.filter((recipe) => (recipe.kind === "side") === (kind === "side")),
    [recipes, kind],
  );
  const kindCategories = useMemo(() => {
    const names = new Set<string>();
    ofKind.forEach((recipe) => { if (recipe.category) names.add(recipe.category); });
    return [...names];
  }, [ofKind]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ofKind
      .filter((recipe) => category === "전체" || recipe.category === category)
      .filter((recipe) => !q || [recipe.name, recipe.category, recipe.memo, ...recipe.ingredients.map((ingredient) => ingredient.name)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [ofKind, category, query]);

  // 하위 레시피를 풀려면 목록 전체가 있어야 한다 — 원가는 한 번에 같이 낸다
  const costs = useMemo(() => {
    const coster = createRecipeCoster(recipes);
    return new Map(recipes.map((recipe) => [recipe.id, coster.recipe(recipe)]));
  }, [recipes]);
  const costOf = (recipe: Recipe) => costs.get(recipe.id)!;

  // 평균 원가율은 판매가가 있는 메뉴만으로 낸다 — 0원 메뉴를 넣으면 평균이 거짓말한다
  const pricedRates = recipes
    .map((recipe) => costOf(recipe).costRate)
    .filter((rate): rate is number => rate !== null);
  const averageCostRate = pricedRates.length ? pricedRates.reduce((sum, rate) => sum + rate, 0) / pricedRates.length : null;
  const menuCount = recipes.filter((recipe) => recipe.kind !== "side").length;
  const sideCount = recipes.length - menuCount;
  const incompleteCount = recipes.filter((recipe) => costOf(recipe).incomplete > 0).length;

  const openNew = () => setEditing({ ...EMPTY_RECIPE, kind });
  const closeEditor = () => setEditing(null);

  const handleSave = (recipe: Recipe) => {
    const isNew = recipe.id <= 0;
    upsertRecipe({ ...recipe, id: isNew ? nextRecipeId(recipes) : recipe.id });
    showToast(isNew ? "레시피를 등록했습니다" : "레시피를 저장했습니다");
    setEditing(null);
  };

  const handleDelete = (recipe: Recipe) => {
    // 다른 레시피에 들어가 있으면 그쪽 원가가 비게 된다 — 지우기 전에 말해 준다
    const users = recipesUsing(recipes, recipe.id);
    const warning = users.length > 0
      ? `\n\n${users.map((user) => `「${user.name}」`).join(" ")}에 재료로 들어가 있습니다. 지우면 그 레시피들은 «확인 필요»로 바뀝니다.`
      : "";
    if (!window.confirm(`${recipe.name} 레시피를 삭제할까요?${warning}`)) return;
    deleteRecipe(recipe.id);
    showToast("레시피를 삭제했습니다");
    setEditing(null);
  };

  return (
    <>
      {/* 제목은 상단바가 이미 «레시피 원가계산»으로 달아 준다 — 여기서는 설명과 버튼만 */}
      <div className="recipe-head">
        <p className="muted small">재료비 ÷ 판매가 = 원가율. 카드를 누르면 고칠 수 있습니다.</p>
        <button className="btn btn-primary" type="button" onClick={openNew}>+ 레시피 등록</button>
      </div>

      <div className="recipe-kpis">
        <div className="dash-kpi">
          <span className="dash-kpi-label">판매 메뉴</span>
          <strong>{menuCount}<em>개</em></strong>
          <small>원가율 계산 대상</small>
        </div>
        <div className="dash-kpi">
          <span className="dash-kpi-label">기본 상차림</span>
          <strong>{sideCount}<em>개</em></strong>
          <small>판매가 없음 · 원가만</small>
        </div>
        <div className={`dash-kpi ${averageCostRate !== null && averageCostRate > 40 ? "warn" : ""}`}>
          <span className="dash-kpi-label">평균 원가율</span>
          <strong>{averageCostRate === null ? "—" : <>{averageCostRate.toFixed(1)}<em>%</em></>}</strong>
          <small>{pricedRates.length ? `판매가 있는 ${pricedRates.length}개 기준` : "판매가를 넣으면 계산됩니다"}</small>
        </div>
        <div className={`dash-kpi ${incompleteCount > 0 ? "warn" : ""}`}>
          <span className="dash-kpi-label">확인 필요</span>
          <strong>{incompleteCount}<em>개</em></strong>
          <small>수량·단가·하위 레시피 확인</small>
        </div>
      </div>

      <Card className="recipe-list-card">
        <div className="recipe-toolbar">
          <div className="segmented fill recipe-kind-tabs" role="tablist" aria-label="레시피 종류">
            {(["menu", "side"] as RecipeKind[]).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={kind === option}
                className={kind === option ? "on" : ""}
                onClick={() => { setKind(option); setCategory("전체"); }}
              >
                {KIND_LABEL[option]} {option === "menu" ? menuCount : sideCount}
              </button>
            ))}
          </div>
          <input
            className="input recipe-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="레시피·재료 검색"
            aria-label="레시피 검색"
          />
        </div>

        {kindCategories.length > 1 && (
          <div className="recipe-cat-row" role="tablist" aria-label="분류">
            {["전체", ...kindCategories].map((option) => (
              <button
                key={option}
                type="button"
                className={`chip chip-sm ${category === option ? "on" : ""}`}
                aria-pressed={category === option}
                onClick={() => setCategory(option)}
              >
                {option}
              </button>
            ))}
          </div>
        )}

        <div className="recipe-cards">
          {visible.map((recipe) => <RecipeCard key={recipe.id} recipe={recipe} cost={costOf(recipe)} onOpen={setEditing} />)}
          {visible.length === 0 && (
            <div className="recipe-empty muted">
              {query || category !== "전체" ? "조건에 맞는 레시피가 없습니다." : `등록된 ${KIND_LABEL[kind]}이 없습니다.`}
              <button className="btn btn-outline btn-sm" type="button" onClick={openNew} style={{ marginTop: 10 }}>+ 레시피 등록</button>
            </div>
          )}
        </div>
      </Card>

      {editing && (
        <RecipeEditor
          key={editing.id || "new"}
          initial={editing}
          recipes={recipes}
          categories={categories}
          vendors={vendors}
          onSave={handleSave}
          onDelete={editing.id > 0 ? handleDelete : undefined}
          onClose={closeEditor}
        />
      )}
    </>
  );
}
