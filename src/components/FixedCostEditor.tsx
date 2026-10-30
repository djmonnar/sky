import { useEffect, useMemo, useState } from "react";
import { Card } from "./ui";
import type { FixedCostItem, FixedCostMonth } from "../data/types";
import {
  FIXED_COST_MAX_ITEMS, FIXED_COST_PRESETS, cleanFixedCostItems, copyFixedCosts, makeFixedCostId, previousMonth, sumFixedCosts,
} from "../lib/fixedCosts";

/*
  손익 탭의 «고정비» 카드 — 그달 임대료·관리비·공과금을 적는다(2026-10-30).
  임대료처럼 매달 같은 것은 «지난달 그대로 가져오기» 뒤 바뀐 것만 고친다. 저장해야 손익에 들어간다.
*/

const money = new Intl.NumberFormat("ko-KR");

function sameItems(a: FixedCostItem[], b: FixedCostItem[]): boolean {
  const clean = (items: FixedCostItem[]) => JSON.stringify(cleanFixedCostItems(items).map(({ name, amount }) => [name, amount]));
  return clean(a) === clean(b);
}

export default function FixedCostEditor({
  month, current, loaded, error, onSave, onLoad,
}: {
  month: string;
  current: FixedCostMonth | null;
  loaded: boolean;
  error: string | null;
  onSave: (items: FixedCostItem[]) => Promise<void>;
  onLoad: (month: string) => Promise<FixedCostMonth | null>;
}) {
  const saved = useMemo(() => current?.items ?? [], [current]);
  const [rows, setRows] = useState<FixedCostItem[]>(saved);
  const [previous, setPrevious] = useState<FixedCostMonth | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const prevMonth = previousMonth(month);

  // 달을 바꾸거나 저장본이 새로 오면 그것으로 다시 그린다
  useEffect(() => { setRows(saved); setSaveError(null); }, [saved, month]);

  // 이번 달이 비었으면 지난달을 한 번 읽어 «그대로 가져오기»를 띄운다
  useEffect(() => {
    let alive = true;
    setPrevious(null);
    if (!loaded || saved.length > 0) return;
    onLoad(prevMonth).then((value) => { if (alive) setPrevious(value); }).catch(() => undefined);
    return () => { alive = false; };
  }, [loaded, saved.length, onLoad, prevMonth]);

  const dirty = !sameItems(rows, saved);
  const total = sumFixedCosts(rows);
  const usedNames = new Set(rows.map((row) => row.name.trim()));

  const update = (id: string, patch: Partial<FixedCostItem>) =>
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const add = (name = "") => {
    if (rows.length >= FIXED_COST_MAX_ITEMS) return;
    setRows((prev) => [...prev, { id: makeFixedCostId(), name, amount: 0 }]);
  };
  const remove = (id: string) => setRows((prev) => prev.filter((row) => row.id !== id));

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(rows);
    } catch (e) {
      setSaveError(`저장하지 못했습니다: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={`${month} 고정비`} icon="🏠">
      <p className="muted small" style={{ marginTop: 0 }}>
        임대료·관리비·공과금처럼 매달 나가는 돈입니다. <strong>적은 달만</strong> 손익에서 뺍니다 — 안 적은 달은
        0원이 아니라 «미입력»으로 둡니다.
      </p>
      {error && <p className="fixed-cost-error" role="alert">고정비를 불러오지 못했습니다: {error}</p>}

      {rows.length === 0 && previous && previous.items.length > 0 && (
        <button type="button" className="btn btn-outline btn-block fixed-cost-copy" onClick={() => setRows(copyFixedCosts(previous.items))}>
          지난달({prevMonth}) 항목 그대로 가져오기 · {previous.items.length}개 · {money.format(sumFixedCosts(previous.items))}원
        </button>
      )}

      <div className="fixed-cost-list">
        {rows.map((row) => (
          <div className="fixed-cost-row" key={row.id}>
            <input
              className="input"
              value={row.name}
              onChange={(e) => update(row.id, { name: e.target.value })}
              placeholder="항목 (예: 임대료)"
              aria-label="고정비 항목"
            />
            <input
              className="input fixed-cost-amount"
              inputMode="numeric"
              value={row.amount ? money.format(row.amount) : ""}
              onChange={(e) => update(row.id, { amount: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 })}
              placeholder="금액 (원)"
              aria-label={`${row.name || "고정비"} 금액`}
            />
            <button type="button" className="icon-btn" aria-label="항목 삭제" onClick={() => remove(row.id)}>×</button>
          </div>
        ))}
      </div>

      <div className="fixed-cost-presets">
        {FIXED_COST_PRESETS.filter((name) => !usedNames.has(name)).map((name) => (
          <button type="button" key={name} className="chip" onClick={() => add(name)}>+ {name}</button>
        ))}
        <button type="button" className="chip" onClick={() => add()}>+ 직접 입력</button>
      </div>

      <div className="fixed-cost-foot">
        <span>합계 <strong>{money.format(total)}원</strong>{dirty && <em className="fixed-cost-dirty"> · 저장 안 됨</em>}</span>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? "저장 중…" : "고정비 저장"}
        </button>
      </div>
      {saveError && <p className="fixed-cost-error" role="alert">{saveError}</p>}
      {current?.updatedAt && !dirty && (
        <p className="muted small" style={{ marginBottom: 0 }}>
          {current.updatedBy ? `${current.updatedBy} · ` : ""}{new Date(current.updatedAt).toLocaleString("ko-KR")} 저장
        </p>
      )}
    </Card>
  );
}
