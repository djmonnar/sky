import { useMemo, useState } from "react";
import { Card } from "./ui";
import type { PurchaseOrder, Recipe } from "../data/types";
import { createRecipeCoster } from "../lib/recipeCost";
import { applyPriceChange, findPriceChanges, type PriceChange } from "../lib/priceWatch";

/*
  레시피 화면 위 «매입 단가가 바뀐 재료» — 최근 발주·입고 단가가 레시피에 적어 둔 단가와 3% 넘게 다르면
  알리고, 그 재료가 든 레시피의 원가율이 어떻게 바뀌는지 보여 준다. 「반영」을 눌러야 레시피가 바뀐다
  (src/lib/priceWatch.ts, 2026-10-30).
*/

const money = new Intl.NumberFormat("ko-KR");

function won(value: number): string {
  return value >= 100 ? `${money.format(Math.round(value))}원` : `${Number(value.toFixed(2)).toLocaleString("ko-KR")}원`;
}

function pct(change: number): string {
  const value = Math.round(change * 100);
  return `${value > 0 ? "+" : ""}${value}%`;
}

function shortDate(date: string): string {
  const [, month, day] = date.split("-");
  return month && day ? `${Number(month)}/${Number(day)}` : date;
}

export default function PriceWatchCard({
  recipes, orders, onApply,
}: {
  recipes: Recipe[];
  orders: PurchaseOrder[];
  onApply: (updated: Recipe[], change: PriceChange) => void;
}) {
  const watch = useMemo(() => findPriceChanges(recipes, orders), [recipes, orders]);
  const coster = useMemo(() => createRecipeCoster(recipes), [recipes]);
  const [open, setOpen] = useState(true);

  if (watch.total === 0 || orders.length === 0) return null;

  const coverage = `이름이 같은 재료만 견줍니다 — 매입 품목과 이름이 맞는 재료 ${watch.matched}/${watch.total}개`
    + (watch.unitMismatch > 0 ? ` · 단위가 달라 못 견준 ${watch.unitMismatch}개` : "");

  if (watch.changes.length === 0) {
    return <p className="muted small price-watch-quiet">📈 매입 단가와 다른 레시피 재료가 없습니다. {coverage}</p>;
  }

  return (
    <Card
      title={`매입 단가가 바뀐 재료 ${watch.changes.length}개`}
      icon="📈"
      className="price-watch-card"
      action={<button type="button" className="text-button" onClick={() => setOpen((v) => !v)}>{open ? "접기" : "펼치기"}</button>}
    >
      {open && (
        <>
          <div className="price-watch-list">
            {watch.changes.map((change) => {
              const updated = applyPriceChange(recipes, change);
              const after = createRecipeCoster(recipes.map((recipe) => updated.find((u) => u.id === recipe.id) ?? recipe));
              const unit = change.latest.unit;
              // 원가가 실제로 움직이는 레시피만 줄로 보인다 — 그 재료 양을 안 적은 레시피는 «0원 → 0원»만 늘어놓게 된다
              const rows = updated
                .map((recipe) => ({
                  recipe,
                  before: coster.recipe(recipes.find((r) => r.id === recipe.id) ?? recipe),
                  next: after.recipe(recipe),
                }))
                .filter(({ before, next }) => Math.abs(next.perServingCost - before.perServingCost) >= 1);
              const quietCount = updated.length - rows.length;
              return (
                <div className={`price-watch-item ${change.change > 0 ? "up" : "down"}`} key={change.key}>
                  <div className="price-watch-head">
                    <strong>{change.name}</strong>
                    <span>
                      {won(change.oldPriceInPurchaseUnit)}/{unit} → <b>{won(change.latest.unitPrice)}/{unit}</b>
                      <em className="price-watch-pct">{pct(change.change)}</em>
                    </span>
                  </div>
                  <div className="muted small">
                    {shortDate(change.latest.date)} {change.latest.vendorName} 발주 기준 · 레시피에 적힌 단가와 비교
                  </div>
                  <ul className="price-watch-recipes">
                    {rows.map(({ recipe, before, next }) => (
                      <li key={recipe.id}>
                        <span>{recipe.name}</span>
                        {recipe.kind === "side" || before.costRate === null || next.costRate === null ? (
                          <span>1회 원가 {won(before.perServingCost)} → {won(next.perServingCost)}</span>
                        ) : (
                          <span className={next.costRate > 40 ? "price-watch-high" : ""}>
                            원가율 {before.costRate.toFixed(1)}% → {next.costRate.toFixed(1)}%
                          </span>
                        )}
                      </li>
                    ))}
                    {quietCount > 0 && (
                      <li className="muted">
                        <span>그 밖에 {quietCount}개 레시피</span>
                        <span>그 재료 양이 비어 있어 원가는 그대로(단가만 바뀜)</span>
                      </li>
                    )}
                  </ul>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => onApply(updated, change)}>
                    레시피 {updated.length}개 단가에 반영
                  </button>
                </div>
              );
            })}
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>{coverage}</p>
        </>
      )}
    </Card>
  );
}
