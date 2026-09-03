import { useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { SalesDailySummary } from "../data/types";
import { TODAY_STR } from "../lib/time";
import {
  PRESETS,
  type Bucket,
  type DateRange,
  type PosView,
  calendarCells,
  clampRange,
  compactWon,
  dateLabel,
  dowMon,
  eachDay,
  fullWon,
  indexByDate,
  intensityLevel,
  matchPreset,
  monthKey,
  monthTitle,
  monthlyBuckets,
  niceMax,
  presetRange,
  rangeLabel,
  rangeStats,
  shiftMonth,
  weeklyBuckets,
} from "../lib/posSales";

interface Props {
  summaries: SalesDailySummary[];
  syncing: boolean;
  onSync: () => void;
}

interface Tip {
  x: number;
  y: number;
  title: string;
  value: string;
  sub?: string;
}

type TipBody = Omit<Tip, "x" | "y">;

const VIEWS: Array<{ id: PosView; label: string }> = [
  { id: "day", label: "일" },
  { id: "week", label: "주" },
  { id: "month", label: "월" },
];

const DOW = ["월", "화", "수", "목", "금", "토", "일"];

function syncedLabel(iso?: string): string {
  return iso ? iso.slice(5, 16).replace("T", " ") : "—";
}

/** 커서 옆에 뜨는 툴팁 — 값이 먼저, 이름이 뒤 */
function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  const flip = tip.x > window.innerWidth - 190;
  return (
    <div
      className="pos-tip"
      role="status"
      style={{ left: flip ? tip.x - 14 : tip.x + 14, top: tip.y + 14, transform: flip ? "translateX(-100%)" : undefined }}
    >
      <strong>{tip.value}</strong>
      <span>{tip.title}</span>
      {tip.sub && <small>{tip.sub}</small>}
    </div>
  );
}

/** 주·월 합계 막대 — 색은 하나, 선택한 막대만 진하게 */
function BucketChart({
  buckets, selectedKey, onPick, onTip, onTipEnd,
}: {
  buckets: Bucket[];
  selectedKey: string | null;
  onPick: (bucket: Bucket) => void;
  onTip: (event: ReactPointerEvent, body: TipBody) => void;
  onTipEnd: () => void;
}) {
  const rawMax = Math.max(0, ...buckets.map((bucket) => bucket.total));
  const max = niceMax(rawMax);
  const bestKey = rawMax > 0
    ? buckets.reduce((best, bucket) => (bucket.total > best.total ? bucket : best)).key
    : null;

  return (
    <div className="pos-chart">
      <div className="pos-chart-axis" aria-hidden="true">
        <span>{compactWon(max)}</span>
        <span>{compactWon(max / 2)}</span>
        <span>0</span>
      </div>
      <div className="pos-chart-plot">
        <div className="pos-gridline" data-gl="100" />
        <div className="pos-gridline" data-gl="50" />
        <div className="pos-gridline" data-gl="0" />
        {buckets.map((bucket) => {
          const ratio = max > 0 ? bucket.total / max : 0;
          const selected = bucket.key === selectedKey;
          // 값 표시는 아껴 쓴다: 최고치와 선택한 것만
          const labelled = (selected || bucket.key === bestKey) && bucket.dataDays > 0;
          return (
            <button
              key={bucket.key}
              type="button"
              className={`pos-col ${selected ? "on" : ""} ${bucket.dataDays === 0 ? "empty" : ""}`}
              style={{ "--h": `${ratio * 100}%` } as CSSProperties}
              onClick={() => onPick(bucket)}
              onPointerMove={(event) => onTip(event, {
                title: `${dateLabel(bucket.start, false)} ~ ${dateLabel(bucket.end, false)}`,
                value: fullWon(bucket.total),
                sub: bucket.dataDays ? `${bucket.dataDays}일치 합계` : "받은 매출 없음",
              })}
              onPointerLeave={onTipEnd}
              aria-pressed={selected}
              aria-label={`${bucket.label} ${fullWon(bucket.total)}`}
            >
              <span className="pos-col-area">
                {labelled && <span className="pos-col-value">{compactWon(bucket.total)}</span>}
                <span className="pos-bar" />
              </span>
              <span className="pos-col-label">{bucket.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function PosSalesBoard({ summaries, syncing, onSync }: Props) {
  const today = TODAY_STR;
  const [view, setView] = useState<PosView>("day");
  const [range, setRange] = useState<DateRange>({ start: today, end: today });
  const [cursor, setCursor] = useState(monthKey(today));
  /** 마우스 드래그 시작점, 또는 터치 첫 탭(종료일을 기다리는 중) */
  const [anchor, setAnchor] = useState<{ date: string; touch: boolean } | null>(null);
  const dragging = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  const index = useMemo(() => indexByDate(summaries), [summaries]);
  const stats = useMemo(() => rangeStats(index, range, today), [index, range, today]);
  const cells = useMemo(() => calendarCells(cursor), [cursor]);
  // 농도는 이 달 안에서 상대 비교 — 최소가 가장 연하고 최대가 가장 진하다
  const [monthMin, monthMax] = useMemo(() => {
    const amounts = cells
      .filter((cell) => cell.inMonth)
      .map((cell) => index.get(cell.date)?.netAmount)
      .filter((value): value is number => value !== undefined);
    return amounts.length ? [Math.min(...amounts), Math.max(...amounts)] : [0, 0];
  }, [cells, index]);
  const weeks = useMemo(() => weeklyBuckets(index, today, 12), [index, today]);
  const months = useMemo(() => monthlyBuckets(index, today, 12), [index, today]);
  const detailRows = useMemo(
    () => eachDay(range).map((date) => ({ date, row: index.get(date) ?? null })),
    [range, index],
  );
  const latest = useMemo(
    () => [...summaries].sort((a, b) => (b.syncedAt ?? "").localeCompare(a.syncedAt ?? ""))[0] ?? null,
    [summaries],
  );
  const activePreset = matchPreset(range, today);

  const selectRange = (next: DateRange) => {
    setRange(next);
    setCursor(monthKey(next.end));
    setAnchor(null);
  };

  /* ---- 달력: 마우스는 드래그, 손가락은 두 번 탭 ---- */

  const dateAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return el?.closest<HTMLElement>("[data-date]")?.dataset.date ?? null;
  };

  const cellPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, date: string) => {
    if (event.pointerType === "touch") {
      // 손가락 드래그는 화면 스크롤과 싸우게 되므로 시작일 → 종료일 두 번 탭으로
      if (anchor?.touch && anchor.date !== date) {
        selectRange(clampRange(anchor.date, date));
      } else {
        setAnchor({ date, touch: true });
        setRange({ start: date, end: date });
      }
      return;
    }
    event.preventDefault();
    dragging.current = true;
    setAnchor({ date, touch: false });
    setRange({ start: date, end: date });
    gridRef.current?.setPointerCapture(event.pointerId);
  };

  const gridPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !anchor) return;
    const date = dateAt(event.clientX, event.clientY);
    if (date) setRange(clampRange(anchor.date, date));
  };

  const gridPointerUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    setAnchor(null);
  };

  const showTip = (event: ReactPointerEvent, body: TipBody) => {
    if (event.pointerType === "touch") return;
    setTip({ x: event.clientX, y: event.clientY, ...body });
  };
  const hideTip = () => setTip(null);

  const inRange = (date: string) => date >= range.start && date <= range.end;
  const buckets = view === "week" ? weeks : months;
  const bucketKey = buckets.find((bucket) => bucket.start === range.start && bucket.end === range.end)?.key ?? null;

  const delta = stats.previous.dataDays > 0 && stats.previous.total > 0
    ? ((stats.total - stats.previous.total) / stats.previous.total) * 100
    : null;
  const missingDays = stats.totalDays - stats.dataDays;

  if (summaries.length === 0) {
    return (
      <div className="card pos-empty">
        <strong>아직 받아온 POS 매출이 없습니다.</strong>
        <p className="muted">네이버 플레이스플러스(오너비스타) 일 매출을 매일 자동으로 받아 옵니다. 지금 바로 받아오려면 아래를 눌러 주세요.</p>
        <button className="btn btn-primary" disabled={syncing} onClick={onSync}>{syncing ? "받는 중..." : "지금 동기화"}</button>
      </div>
    );
  }

  return (
    <div className="pos-board">
      {/* ── 집계 단위 + 동기화 ── */}
      <div className="pos-toolbar">
        <div className="segmented pos-views" role="tablist" aria-label="집계 단위">
          {VIEWS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={view === item.id}
              className={view === item.id ? "on" : ""}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="pos-sync">
          <span className="muted small">
            {latest?.syncedAt ? `${syncedLabel(latest.syncedAt)} 받음` : "아직 받은 적 없음"}
            {latest?.sourceLabel ? ` · ${latest.sourceLabel}` : ""}
          </span>
          <button className="btn btn-outline btn-sm" disabled={syncing} onClick={onSync}>{syncing ? "받는 중..." : "지금 동기화"}</button>
        </div>
      </div>

      {/* ── 기간: 프리셋이 먼저, 직접 지정은 뒤 ── */}
      <div className="pos-filters">
        <div className="pos-presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.key}
              className={`chip ${activePreset === preset.key ? "on" : ""}`}
              onClick={() => selectRange(presetRange(preset.key, today))}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="pos-dates">
          <input
            className="input"
            type="date"
            value={range.start}
            aria-label="시작일"
            onChange={(event) => event.target.value && selectRange(clampRange(event.target.value, range.end))}
          />
          <span className="pos-dates-sep">~</span>
          <input
            className="input"
            type="date"
            value={range.end}
            aria-label="종료일"
            onChange={(event) => event.target.value && selectRange(clampRange(range.start, event.target.value))}
          />
        </div>
      </div>

      {/* ── 선택 기간 요약 ── */}
      <div className="pos-stats">
        <div className="pos-hero">
          <span className="pos-hero-label">{rangeLabel(range)} 매출</span>
          <strong className="pos-hero-value">{fullWon(stats.total)}</strong>
          <div className="pos-hero-meta">
            {delta !== null && (
              <span className={`pos-delta ${delta >= 0 ? "up" : "down"}`}>
                {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
                <em>직전 {stats.totalDays}일 대비</em>
              </span>
            )}
            <span className="muted small">
              {stats.totalDays}일 중 {stats.dataDays}일 데이터
              {missingDays > 0 ? ` · 없는 날 ${missingDays}일` : ""}
              {stats.futureDays > 0 ? ` · 남은 날 ${stats.futureDays}일` : ""}
            </span>
          </div>
        </div>
        <div className="pos-stat">
          <span>일평균</span>
          <strong>{fullWon(stats.average)}</strong>
          <small>데이터 있는 날 기준</small>
        </div>
        <div className="pos-stat">
          <span>최고 매출일</span>
          <strong>{stats.best ? fullWon(stats.best.amount) : "—"}</strong>
          <small>{stats.best ? dateLabel(stats.best.date) : "데이터 없음"}</small>
        </div>
      </div>

      {/* ── 일: 달력 ── */}
      {view === "day" && (
        <div className="card pos-calendar-card">
          <div className="pos-cal-head">
            <button className="icon-btn-sm" aria-label="이전 달" onClick={() => setCursor(shiftMonth(cursor, -1))}>‹</button>
            <strong>{monthTitle(cursor)}</strong>
            <button className="icon-btn-sm" aria-label="다음 달" onClick={() => setCursor(shiftMonth(cursor, 1))}>›</button>
            <button
              className="btn btn-outline btn-sm pos-cal-today"
              onClick={() => { setCursor(monthKey(today)); selectRange({ start: today, end: today }); }}
            >
              오늘
            </button>
          </div>
          <div className="pos-dow" aria-hidden="true">
            {DOW.map((label, i) => <span key={label} className={i >= 5 ? "weekend" : ""}>{label}</span>)}
          </div>
          <div
            ref={gridRef}
            className="pos-grid"
            role="grid"
            aria-label="일별 매출 달력"
            onPointerMove={gridPointerMove}
            onPointerUp={gridPointerUp}
            onPointerCancel={gridPointerUp}
          >
            {cells.map((cell) => {
              const row = index.get(cell.date);
              const amount = row ? row.netAmount : null;
              const level = intensityLevel(amount, monthMin, monthMax);
              const selected = inRange(cell.date);
              const edge = selected && (cell.date === range.start || cell.date === range.end);
              const classes = [
                "pos-cell",
                cell.inMonth ? "" : "out",
                selected ? "sel" : "",
                edge ? "edge" : "",
                cell.date === today ? "today" : "",
                anchor?.touch && anchor.date === cell.date ? "anchor" : "",
              ].filter(Boolean).join(" ");
              return (
                <button
                  key={cell.date}
                  type="button"
                  role="gridcell"
                  data-date={cell.date}
                  data-level={level}
                  aria-selected={selected}
                  aria-label={`${dateLabel(cell.date)} ${amount === null ? "데이터 없음" : fullWon(amount)}`}
                  className={classes}
                  onPointerDown={(event) => cellPointerDown(event, cell.date)}
                  onPointerMove={(event) => showTip(event, {
                    title: dateLabel(cell.date),
                    value: amount === null ? "데이터 없음" : fullWon(amount),
                    sub: row?.hasOrderCount ? `${row.orderCount}건` : undefined,
                  })}
                  onPointerLeave={hideTip}
                >
                  <span className="pos-cell-day">{cell.day}</span>
                  <span className="pos-cell-amt">{amount === null ? "" : compactWon(amount)}</span>
                </button>
              );
            })}
          </div>
          <div className="pos-cal-foot">
            <span className="muted small">
              {anchor?.touch ? "종료일을 눌러 주세요" : "드래그하거나, 시작일과 종료일을 차례로 눌러 기간을 고르세요"}
            </span>
            <span className="pos-legend" aria-hidden="true">
              <span className="muted small">적음</span>
              {[1, 2, 3, 4, 5].map((level) => <i key={level} data-level={level} />)}
              <span className="muted small">많음</span>
            </span>
          </div>
        </div>
      )}

      {/* ── 주 / 월: 막대 ── */}
      {view !== "day" && (
        <div className="card pos-chart-card">
          <div className="card-head">
            <div className="card-title">{view === "week" ? "최근 12주 매출" : "최근 12개월 매출"}</div>
            <span className="muted small">막대를 누르면 그 {view === "week" ? "주" : "달"}이 선택됩니다</span>
          </div>
          <BucketChart
            buckets={buckets}
            selectedKey={bucketKey}
            onPick={(bucket) => selectRange({ start: bucket.start, end: bucket.end })}
            onTip={showTip}
            onTipEnd={hideTip}
          />
        </div>
      )}

      {/* ── 선택 기간 상세 — 표로도 모든 값에 닿는다 ── */}
      <div className="card pos-detail-card">
        <div className="card-head">
          <div className="card-title">선택 기간 상세</div>
          <span className="muted small">{rangeLabel(range)}</span>
        </div>
        <div className="pos-detail">
          <table className="table pos-detail-table">
            <thead>
              <tr>
                <th>날짜</th>
                <th className="num">매출</th>
                <th className="num pos-col-count">건수</th>
                <th className="pos-col-sync">받은 때</th>
              </tr>
            </thead>
            <tbody>
              {detailRows.map(({ date, row }) => {
                const dow = dowMon(date);
                return (
                  <tr key={date} className={row ? "" : "none"}>
                    <td>
                      {dateLabel(date, false)}
                      <span className={`pos-detail-dow ${dow >= 5 ? "weekend" : ""}`}>{DOW[dow]}</span>
                    </td>
                    <td className="num bold">{row ? fullWon(row.netAmount) : <span className="muted">—</span>}</td>
                    <td className="num pos-col-count">{row?.hasOrderCount ? `${row.orderCount}건` : <span className="muted">—</span>}</td>
                    <td className="muted small pos-col-sync">{syncedLabel(row?.syncedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>합계 · {stats.dataDays}일</td>
                <td className="num bold">{fullWon(stats.total)}</td>
                <td className="pos-col-count" />
                <td className="pos-col-sync" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <p className="pos-note muted small">
        네이버 플레이스플러스 매출을 오너비스타에서 매일 받아 옵니다. 카드 매출과 다른 숫자입니다 — 현금·계좌이체가 모두 들어 있고,
        아직 정산 안 된 것도 들어 있습니다. 날짜와 금액만 오고, 건수·시간대별·메뉴별은 네이버가 주지 않습니다.
      </p>

      <Tooltip tip={tip} />
    </div>
  );
}
