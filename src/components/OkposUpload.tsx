import { useEffect, useMemo, useRef, useState } from "react";
import type { OkposDailyReport, SalesDailySummary } from "../data/types";
import { TODAY_STR } from "../lib/time";
import { dateLabel, fullWon } from "../lib/posSales";
import {
  OkposParseError, PAYMENT_GROUP_LABELS, okposPaymentGroups, parseOkposDaily,
  type OkposParseResult, type OkposPaymentGroups,
} from "../lib/okposDaily";

/*
  OK포스 「일자별 (일별종합)」 엑셀 올리기.

  **바로 넣지 않고 먼저 보여 준다.** 엑셀은 날짜·칸을 잘못 읽으면 한 달 매출이 통째로
  틀어진다. 몇 날짜가 얼마로 바뀌는지, 네이버 숫자와 얼마나 다른지, 엑셀에서 이상한
  점은 없는지를 보고 사장님이 「반영하기」를 눌러야 들어간다. 넣은 뒤에도 바로
  되돌릴 수 있다.

  .xls 를 푸는 라이브러리(SheetJS)는 무겁다 — 이 버튼을 눌렀을 때만 불러온다.
*/

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const GROUP_KEYS: Array<keyof OkposPaymentGroups> = ["card", "cash", "voucher", "other", "unlisted"];

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; fileName: string }
  | { kind: "error"; fileName: string; message: string }
  | { kind: "preview"; fileName: string; result: OkposParseResult }
  | { kind: "saving"; fileName: string; result: OkposParseResult }
  | { kind: "done"; fileName: string; dates: string[] }
  | { kind: "undoing"; fileName: string; dates: string[] }
  | { kind: "undone"; fileName: string; count: number };

interface Props {
  summaries: SalesDailySummary[];
  onSave: (days: OkposDailyReport[]) => Promise<void>;
  onClear: (dates: string[]) => Promise<void>;
  /** 버튼 모양 — 툴바에서는 작게, 빈 화면에서는 크게 */
  size?: "sm" | "md";
}

function signedWon(value: number): string {
  if (value === 0) return "0원";
  return `${value > 0 ? "+" : "−"}${fullWon(Math.abs(value))}`;
}

function shortDate(key: string): string {
  return `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
}

async function readRows(file: File): Promise<unknown[][]> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new OkposParseError("엑셀에 시트가 없습니다.");
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
}

export default function OkposUpload({ summaries, onSave, onClear, size = "sm" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const open = phase.kind !== "idle" && phase.kind !== "reading";

  const byDate = useMemo(() => new Map(summaries.map((row) => [row.businessDate, row])), [summaries]);

  // 창이 열린 동안 뒤 화면은 안 움직인다. Esc 로 닫는다(저장 중에는 못 닫는다).
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && phase.kind !== "saving" && phase.kind !== "undoing") setPhase({ kind: "idle" });
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, phase.kind]);

  const pick = async (file: File | undefined) => {
    if (inputRef.current) inputRef.current.value = ""; // 같은 파일을 다시 골라도 다시 읽게
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setPhase({ kind: "error", fileName: file.name, message: "파일이 너무 큽니다(5MB 넘음). OK포스 「일자별 (일별종합)」 엑셀이 맞는지 확인해 주세요." });
      return;
    }
    setPhase({ kind: "reading", fileName: file.name });
    try {
      const rows = await readRows(file);
      const result = parseOkposDaily(rows, TODAY_STR, file.name);
      if (result.days.length === 0) {
        setPhase({ kind: "error", fileName: file.name, message: ["반영할 날이 없습니다.", ...result.warnings].join(" ") });
        return;
      }
      setPhase({ kind: "preview", fileName: file.name, result });
    } catch (error) {
      const message = error instanceof OkposParseError
        ? error.message
        : "엑셀을 열지 못했습니다. OK포스에서 내려받은 .xls 파일인지 확인해 주세요.";
      if (!(error instanceof OkposParseError)) console.error(error);
      setPhase({ kind: "error", fileName: file.name, message });
    }
  };

  const save = async () => {
    if (phase.kind !== "preview") return;
    const { fileName, result } = phase;
    setPhase({ kind: "saving", fileName, result });
    try {
      await onSave(result.days);
      setPhase({ kind: "done", fileName, dates: result.days.map((day) => day.businessDate) });
    } catch (error) {
      console.error(error);
      setPhase({ kind: "error", fileName, message: "반영하지 못했습니다. 권한이나 인터넷 연결을 확인해 주세요. 아무것도 바뀌지 않았을 수도, 일부만 들어갔을 수도 있습니다 — 다시 올리면 덮어씁니다." });
    }
  };

  const undo = async () => {
    if (phase.kind !== "done") return;
    const { fileName, dates } = phase;
    setPhase({ kind: "undoing", fileName, dates });
    try {
      await onClear(dates);
      setPhase({ kind: "undone", fileName, count: dates.length });
    } catch (error) {
      console.error(error);
      setPhase({ kind: "error", fileName, message: "되돌리지 못했습니다. 권한이나 인터넷 연결을 확인해 주세요." });
    }
  };

  const close = () => {
    if (phase.kind === "saving" || phase.kind === "undoing") return;
    setPhase({ kind: "idle" });
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        onChange={(event) => void pick(event.target.files?.[0])}
      />
      <button
        className={`btn ${size === "sm" ? "btn-outline btn-sm" : "btn-primary"}`}
        type="button"
        disabled={phase.kind === "reading"}
        onClick={() => inputRef.current?.click()}
      >
        {phase.kind === "reading" ? "엑셀 읽는 중..." : "OK포스 엑셀 올리기"}
      </button>

      {open && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section className="modal-panel okpos-modal" role="dialog" aria-modal="true" aria-labelledby="okpos-modal-title">
            <div className="modal-head">
              <div>
                <h2 id="okpos-modal-title">OK포스 매출 반영</h2>
                <p className="okpos-file">{phase.fileName}</p>
              </div>
              <button className="icon-btn" type="button" onClick={close} aria-label="닫기">×</button>
            </div>

            {phase.kind === "error" && (
              <>
                <div className="modal-body"><p className="okpos-error" role="alert">{phase.message}</p></div>
                <div className="okpos-foot"><button className="btn btn-primary" type="button" onClick={close}>닫기</button></div>
              </>
            )}

            {(phase.kind === "preview" || phase.kind === "saving") && (
              <Preview
                result={phase.result}
                byDate={byDate}
                saving={phase.kind === "saving"}
                onSave={() => void save()}
                onCancel={close}
              />
            )}

            {(phase.kind === "done" || phase.kind === "undoing") && (
              <>
                <div className="modal-body">
                  <p className="okpos-done">
                    <strong>{phase.dates.length}일 반영했습니다.</strong>{" "}
                    {shortDate(phase.dates[0])} ~ {shortDate(phase.dates[phase.dates.length - 1])} 매출은 이제 OK포스 숫자입니다.
                    네이버 숫자는 지우지 않고 비교용으로 남겨 두었습니다.
                  </p>
                  <p className="muted small">잘못 올렸으면 바로 되돌릴 수 있습니다. 같은 날짜를 다시 올리면 덮어씁니다.</p>
                </div>
                <div className="okpos-foot">
                  <button className="btn btn-outline" type="button" disabled={phase.kind === "undoing"} onClick={() => void undo()}>
                    {phase.kind === "undoing" ? "되돌리는 중..." : "되돌리기"}
                  </button>
                  <button className="btn btn-primary" type="button" disabled={phase.kind === "undoing"} onClick={close}>확인</button>
                </div>
              </>
            )}

            {phase.kind === "undone" && (
              <>
                <div className="modal-body"><p className="okpos-done">{phase.count}일을 되돌렸습니다. 그 날들은 다시 네이버 숫자입니다.</p></div>
                <div className="okpos-foot"><button className="btn btn-primary" type="button" onClick={close}>확인</button></div>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function Preview({
  result, byDate, saving, onSave, onCancel,
}: {
  result: OkposParseResult;
  byDate: Map<string, SalesDailySummary>;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const days = result.days;
  const first = days[0].businessDate;
  const last = days[days.length - 1].businessDate;
  const total = days.reduce((sum, day) => sum + day.netAmount, 0);
  const groups = days.reduce<OkposPaymentGroups>((acc, day) => {
    const g = okposPaymentGroups(day);
    GROUP_KEYS.forEach((key) => { acc[key] += g[key]; });
    return acc;
  }, { card: 0, cash: 0, voucher: 0, other: 0, unlisted: 0 });
  const compared = days.filter((day) => typeof byDate.get(day.businessDate)?.naverNetAmount === "number");
  const naverTotal = compared.reduce((sum, day) => sum + (byDate.get(day.businessDate)?.naverNetAmount ?? 0), 0);
  const okposOnCompared = compared.reduce((sum, day) => sum + day.netAmount, 0);
  const overwriting = days.filter((day) => byDate.get(day.businessDate)?.okpos).length;

  return (
    <>
      <div className="modal-body okpos-body">
        <div className="okpos-summary">
          <div>
            <span className="muted small">{first === last ? dateLabel(first) : `${dateLabel(first, false)} ~ ${dateLabel(last, false)}`} · {days.length}일</span>
            <strong>{fullWon(total)}</strong>
          </div>
          {compared.length > 0 && (
            <div>
              <span className="muted small">같은 {compared.length}일 네이버 숫자</span>
              <strong className="okpos-naver">{fullWon(naverTotal)}</strong>
              <span className={`okpos-gap ${okposOnCompared - naverTotal >= 0 ? "up" : "down"}`}>
                OK포스가 {signedWon(okposOnCompared - naverTotal)}
              </span>
            </div>
          )}
        </div>

        {/* 결제수단 묶음 — 네이버가 못 읽는 현금·상품권이 여기 드러난다 */}
        <ul className="okpos-groups">
          {GROUP_KEYS.filter((key) => key === "card" || key === "cash" || groups[key] > 0).map((key) => (
            <li key={key} className={key === "unlisted" ? "unlisted" : ""}>
              <span>{PAYMENT_GROUP_LABELS[key]}</span>
              <strong>{fullWon(groups[key])}</strong>
            </li>
          ))}
        </ul>
        {groups.unlisted > 0 && (
          <p className="okpos-note">
            「엑셀에 칸 없는 결제」는 결제합계에는 있는데 엑셀에 수단 칸이 없는 금액입니다. 어떤 결제(지역화폐·계좌이체 등)인지는
            엑셀로 알 수 없어 그대로 둡니다 — OK포스 결제수단별 화면에서 확인해 주세요.
          </p>
        )}

        {(result.warnings.length > 0 || overwriting > 0) && (
          <ul className="okpos-warnings" aria-label="확인할 점">
            {overwriting > 0 && <li>이미 OK포스로 반영된 날 {overwriting}일은 이번 엑셀로 덮어씁니다.</li>}
            {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        )}

        <div className="okpos-table-wrap">
          <table className="table okpos-table">
            <thead>
              <tr>
                <th>날짜</th>
                <th className="num">실매출</th>
                <th className="num">카드</th>
                <th className="num">현금</th>
                <th className="num">칸 없는 결제</th>
                <th className="num">네이버</th>
                <th className="num">차이</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => {
                const g = okposPaymentGroups(day);
                const naver = byDate.get(day.businessDate)?.naverNetAmount;
                return (
                  <tr key={day.businessDate}>
                    <td>{dateLabel(day.businessDate)}</td>
                    <td className="num bold">{fullWon(day.netAmount)}</td>
                    <td className="num">{fullWon(g.card)}</td>
                    <td className="num">{fullWon(g.cash)}</td>
                    <td className="num">{g.unlisted ? fullWon(g.unlisted) : <span className="muted">—</span>}</td>
                    <td className="num muted">{typeof naver === "number" ? fullWon(naver) : "—"}</td>
                    <td className="num">{typeof naver === "number" ? signedWon(day.netAmount - naver) : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="okpos-foot">
        <button className="btn btn-outline" type="button" onClick={onCancel} disabled={saving}>취소</button>
        <button className="btn btn-primary" type="button" onClick={onSave} disabled={saving}>
          {saving ? "반영하는 중..." : `${days.length}일 반영하기`}
        </button>
      </div>
    </>
  );
}
