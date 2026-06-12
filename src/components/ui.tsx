import { ReactNode } from "react";
import { ResvStatus } from "../data";

/* ---------- 상태 배지 ---------- */
const STATUS_COLOR: Record<ResvStatus, string> = {
  예약확정: "green",
  방문완료: "gray",
  취소: "red",
  노쇼: "red",
  단체: "orange",
  확인전화필요: "amber",
  예약대기: "blue",
};

export function StatusBadge({ status }: { status: ResvStatus }) {
  return <span className={`badge ${STATUS_COLOR[status]}`}>{status}</span>;
}

export function Badge({ tone = "green", children }: { tone?: string; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

/* ---------- 카드 ---------- */
export function Card({
  title, icon, action, children, className = "",
}: {
  title?: ReactNode; icon?: string; action?: ReactNode;
  children: ReactNode; className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card-head">
          <div className="card-title">
            {icon && <span>{icon}</span>}
            {title}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/* ---------- KPI ---------- */
export function StatCard({
  label, value, unit, trend, trendUp, icon, tone = "",
}: {
  label: string; value: ReactNode; unit?: string;
  trend?: string; trendUp?: boolean; icon: string; tone?: string;
}) {
  return (
    <div className="stat-card">
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">
          {value}
          {unit && <span className="unit">{unit}</span>}
        </div>
        {trend && (
          <div className={`stat-trend ${trendUp ? "up" : "down"}`}>
            {trendUp ? "▲" : "▼"} {trend}
          </div>
        )}
      </div>
      <div className={`stat-icon ${tone}`}>{icon}</div>
    </div>
  );
}

/* ---------- 빠른 시간 입력 ---------- */
export function TimeQuick({
  label, value, onChange, presets, presetLabels, badge,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  presets: string[];
  presetLabels?: string[];
  badge?: ReactNode;
}) {
  const step = (delta: number) => {
    const [h, m] = value.split(":").map(Number);
    const total = Math.max(0, Math.min(1439, h * 60 + m + delta));
    onChange(
      `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
    );
  };
  return (
    <div>
      <div className="spread" style={{ marginBottom: 8 }}>
        <span className="field-label" style={{ marginBottom: 0 }}>{label}</span>
        {badge}
      </div>
      <div className="row" style={{ gap: 14, flexWrap: "wrap" }}>
        <span className="time-display">{value}</span>
        <div className="time-stepper">
          <button className="step-btn" onClick={() => step(-15)}>−15분</button>
          <button className="step-btn" onClick={() => step(15)}>+15분</button>
        </div>
      </div>
      <div className="chip-row" style={{ marginTop: 10 }}>
        {presets.map((p, i) => (
          <button
            key={p}
            className={`chip ${value === p ? "on" : ""}`}
            onClick={() => onChange(p)}
          >
            {presetLabels ? presetLabels[i] : p}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- 버튼형 단일선택 ---------- */
export function ChipSelect<T extends string | number>({
  options, value, onChange, format,
}: {
  options: T[]; value: T; onChange: (v: T) => void;
  format?: (v: T) => string;
}) {
  return (
    <div className="chip-row">
      {options.map((o) => (
        <button
          key={String(o)}
          className={`chip ${o === value ? "on" : ""}`}
          onClick={() => onChange(o)}
        >
          {format ? format(o) : String(o)}
        </button>
      ))}
    </div>
  );
}
