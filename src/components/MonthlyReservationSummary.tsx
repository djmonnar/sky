import { useMemo, useState } from "react";
import { Card } from "./ui";
import type { Reservation } from "../data/types";
import {
  daySheetRows, defaultSummaryMonth, dowOf, monthLabel, monthSummaryText, reservationListRows, shiftMonth, summarizeMonth,
  summarySheetRows, tallyText,
} from "../lib/monthlyReservations";

/*
  예약 화면 「📊 월별 집계」 — 월마감 때 그 달 예약 건수·인원을 직접 뽑는다(src/lib/monthlyReservations.ts, 2026-11-02).
  글로 복사(카톡에 붙여 넣기)와 엑셀(요약·날짜별)을 낸다. 예약 권한이 있는 사람(관리자·예약 권한 매니저)의 엑셀에는
  「예약 목록」(예약자명·연락처) 시트가 더 들어간다 — 실무자는 숫자만.
*/

export default function MonthlyReservationSummary({
  reservations, today, includeList, onClose, showToast,
}: {
  reservations: Reservation[];
  today: string;
  /** 엑셀에 「예약 목록」(예약자명·연락처)을 넣을지 — 예약 권한(canAccess("reservations"))이 있는 사람만 */
  includeList: boolean;
  onClose: () => void;
  showToast: (message: string) => void;
}) {
  const [month, setMonth] = useState(() => defaultSummaryMonth(today));
  const [showDays, setShowDays] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = useMemo(() => summarizeMonth(reservations, month), [reservations, month]);
  const days = s.days.filter((d) => d.total.teams > 0);

  const copy = async () => {
    const text = monthSummaryText(s);
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${monthLabel(month)} 예약 집계를 복사했습니다`);
    } catch {
      window.prompt("이 글을 복사해 보내 주세요", text);
    }
  };

  const download = async () => {
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const book = XLSX.utils.book_new();
      const summary = XLSX.utils.aoa_to_sheet(summarySheetRows(s));
      summary["!cols"] = [{ wch: 26 }, { wch: 8 }, { wch: 8 }];
      const byDay = XLSX.utils.aoa_to_sheet(daySheetRows(s));
      byDay["!cols"] = [{ wch: 12 }, { wch: 5 }, ...Array.from({ length: 9 }, () => ({ wch: 10 }))];
      XLSX.utils.book_append_sheet(book, summary, "요약");
      XLSX.utils.book_append_sheet(book, byDay, "날짜별");
      if (includeList) {
        const list = XLSX.utils.aoa_to_sheet(reservationListRows(reservations, month));
        list["!cols"] = [{ wch: 12 }, { wch: 5 }, { wch: 7 }, { wch: 12 }, { wch: 15 }, { wch: 6 }, { wch: 10 }, { wch: 9 }, { wch: 10 }, { wch: 30 }];
        XLSX.utils.book_append_sheet(book, list, "예약 목록");
      }
      XLSX.writeFile(book, `하늘땅_예약집계_${month}.xlsx`);
    } catch {
      showToast("엑셀을 만들지 못했습니다. 다시 눌러 주세요");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="월별 예약 집계"
      icon="📊"
      className="month-resv-card"
      action={<button type="button" className="text-button" onClick={onClose}>닫기</button>}
    >
      <div className="month-resv-top">
        <div className="month-resv-step">
          <button type="button" className="icon-btn" aria-label="이전 달" onClick={() => setMonth((m) => shiftMonth(m, -1))}>‹</button>
          <strong>{monthLabel(month)}</strong>
          <button type="button" className="icon-btn" aria-label="다음 달" onClick={() => setMonth((m) => shiftMonth(m, 1))}>›</button>
        </div>
        <div className="month-resv-actions">
          <button type="button" className="btn btn-outline btn-sm" onClick={copy} disabled={s.total.teams === 0}>글로 복사</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={download} disabled={busy}>
            {busy ? "만드는 중…" : "엑셀로 받기"}
          </button>
        </div>
      </div>

      {s.total.teams === 0 ? (
        <p className="muted month-resv-empty">
          {monthLabel(month)} 예약일로 등록된 예약이 없습니다{s.canceled.teams > 0 ? ` (취소 ${tallyText(s.canceled)}만 있음)` : ""}.
        </p>
      ) : (
        <>
          <div className="month-resv-total">
            <span>전체</span>
            <strong>{s.total.teams.toLocaleString("ko-KR")}<small>건</small> {s.total.people.toLocaleString("ko-KR")}<small>명</small></strong>
          </div>
          <div className="month-resv-grid">
            <div><span>네이버</span><b>{tallyText(s.naver)}</b></div>
            <div><span>직접 입력</span><b>{tallyText(s.manual)}</b></div>
            <div><span>점심(15시 전)</span><b>{tallyText(s.lunch)}</b></div>
            <div><span>저녁</span><b>{tallyText(s.dinner)}</b></div>
          </div>
          <div className="month-resv-status">
            {s.byStatus.map(({ status, tally }) => (
              <span key={status} className={`month-resv-chip${status === "노쇼" ? " bad" : ""}`}>
                {status} {tallyText(tally)}
              </span>
            ))}
          </div>
          {s.duplicateSuspects.teams > 0 && (
            <p className="month-resv-warn">
              네이버 예약과 직접 입력한 예약이 같은 손님일 수 있는 것이 {tallyText(s.duplicateSuspects)} 있습니다.
              예약 목록의 「중복 확인 필요」를 정리하면 숫자가 줄 수 있습니다.
            </p>
          )}
          {s.busiest && (
            <p className="muted small month-resv-note">
              가장 많았던 날: {Number(s.busiest.date.slice(5, 7))}/{Number(s.busiest.date.slice(8, 10))}({dowOf(s.busiest.date)}) {tallyText(s.busiest.total)}
            </p>
          )}

          <button type="button" className="text-button month-resv-days-toggle" onClick={() => setShowDays((v) => !v)}>
            {showDays ? "날짜별 숨기기" : `날짜별 보기 (${days.length}일)`}
          </button>
          {showDays && (
            <div className="table-wrap month-resv-days">
              <table className="table">
                <thead>
                  <tr><th>날짜</th><th className="num">건수</th><th className="num">인원</th><th className="num">점심</th><th className="num">저녁</th></tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.date}>
                      <td>{Number(d.date.slice(5, 7))}/{Number(d.date.slice(8, 10))}({dowOf(d.date)})</td>
                      <td className="num">{d.total.teams}</td>
                      <td className="num">{d.total.people}</td>
                      <td className="num">{d.lunch.people}명</td>
                      <td className="num">{d.dinner.people}명</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <p className="muted small month-resv-note">
        예약일 기준입니다. 「취소」 상태 예약은 빼고{s.canceled.teams > 0 ? `(${tallyText(s.canceled)})` : ""}, 노쇼는 넣어 셉니다.
        네이버에서 취소된 예약과 목록에서 지운 예약은 남아 있지 않아 세지 못합니다.
        {includeList
          ? " 엑셀 「예약 목록」 시트에 예약자명·연락처가 들어갑니다 — 파일을 보낼 때 받는 사람을 꼭 확인해 주세요."
          : " 엑셀에는 숫자만 들어갑니다(예약자 목록은 관리자·예약 권한 매니저만)."}
      </p>
    </Card>
  );
}
