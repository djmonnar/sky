import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Badge, Card } from "./ui";
import { fmtMinutes, foldAttendanceMonth, monthTotals } from "../lib/attendance";
import { DOW_KO, TODAY_STR, dowIndex } from "../data";

/* ============================================================
   이번 달 근무내역 (직원용)

   출퇴근 버튼이 남긴 기록(attendanceLogs)을 날짜별로 접어 보여 주고,
   월말에 「관리자에게 보내기」로 제출한다. 제출은 합계만 담은 문서 한 장이고
   (timesheetSubmissions), 원본 기록은 그대로 남아 관리자가 언제든 다시 볼 수 있다.

   다시 보내면 덮어쓴다 — 달이 끝나기 전에 미리 보내 두고, 마지막 날 한 번 더
   보내는 쓰임을 막지 않기 위해서다.
   ============================================================ */

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${y}년 ${Number(m)}월`;
}

function shiftMonth(month: string, amount: number): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(y, (m - 1) + amount, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function dayLabel(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  const dow = DOW_KO[dowIndex(new Date(date))];
  return `${m}/${d} (${dow})`;
}

export default function MonthlyTimesheet() {
  const {
    mode, attendanceLogs, attendanceMonth, setAttendanceMonth,
    currentEmployee, submitTimesheet, timesheetSubmissions, showToast,
  } = useStore();

  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  const days = useMemo(
    () => foldAttendanceMonth(attendanceLogs, currentEmployee?.id ?? 0, "23:59"),
    [attendanceLogs, currentEmployee]
  );
  const totals = useMemo(() => monthTotals(days), [days]);

  const mySubmission = timesheetSubmissions.find(
    (row) => row.empId === currentEmployee?.id && row.month === attendanceMonth
  );

  const thisMonth = TODAY_STR.slice(0, 7);
  const isFuture = attendanceMonth > thisMonth;

  const send = async () => {
    if (totals.workedDays === 0) {
      showToast("보낼 근무 기록이 없습니다.");
      return;
    }
    const ok = window.confirm(
      `${monthLabel(attendanceMonth)} 근무내역을 관리자에게 보낼까요?\n`
      + `근무 ${totals.workedDays}일 · ${fmtMinutes(totals.totalMinutes)}\n`
      + "보낸 뒤에도 다시 보내면 새 내용으로 바뀝니다."
    );
    if (!ok) return;
    setSending(true);
    try {
      await submitTimesheet(note);
      setNote("");
      showToast("근무내역을 관리자에게 보냈습니다.");
    } catch (e) {
      showToast(`보내지 못했습니다: ${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="stack">
      <Card>
        <div className="timesheet-head">
          <div className="row" style={{ gap: 6 }}>
            <button
              type="button"
              className="icon-btn"
              aria-label="지난달 보기"
              onClick={() => setAttendanceMonth(shiftMonth(attendanceMonth, -1))}
            >
              ‹
            </button>
            <strong style={{ fontSize: 16 }}>{monthLabel(attendanceMonth)}</strong>
            <button
              type="button"
              className="icon-btn"
              aria-label="다음달 보기"
              disabled={attendanceMonth >= thisMonth}
              onClick={() => setAttendanceMonth(shiftMonth(attendanceMonth, 1))}
            >
              ›
            </button>
          </div>
          {mySubmission && (
            <Badge tone={mySubmission.status === "확인완료" ? "green" : "amber"}>
              {mySubmission.status === "확인완료" ? "관리자 확인완료" : "제출됨"}
            </Badge>
          )}
        </div>

        <div className="timesheet-totals">
          <div><span className="k">근무일</span><strong>{totals.workedDays}일</strong></div>
          <div><span className="k">근무시간</span><strong>{fmtMinutes(totals.totalMinutes)}</strong></div>
          <div><span className="k">휴게시간</span><strong>{fmtMinutes(totals.breakMinutes)}</strong></div>
        </div>

        {mySubmission?.submittedAt && (
          <div className="muted small" style={{ marginTop: 8 }}>
            {mySubmission.submittedAt} 에 보냄
            {mySubmission.reviewedAt && ` · ${mySubmission.reviewedBy ?? "관리자"}님이 ${mySubmission.reviewedAt} 에 확인`}
          </div>
        )}
      </Card>

      <Card title="날짜별 기록" icon="🗓️" action={<span className="muted small">{days.length}일</span>}>
        {days.length === 0 ? (
          <div className="empty-state">
            {isFuture ? "아직 오지 않은 달입니다." : "이 달에는 출퇴근 기록이 없습니다."}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table timesheet-table">
              <thead>
                <tr>
                  <th>날짜</th><th>출근</th><th>퇴근</th><th>휴게</th><th>근무</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) => (
                  <tr key={day.date} className={day.date === TODAY_STR ? "sel" : ""}>
                    <td className="bold">{dayLabel(day.date)}</td>
                    <td className="num">{day.inAt ?? "-"}</td>
                    <td className="num">
                      {day.outAt ?? <span className="muted">미퇴근</span>}
                    </td>
                    <td className="num muted">{day.breakMinutes > 0 ? fmtMinutes(day.breakMinutes) : "-"}</td>
                    <td className="num bold">{fmtMinutes(day.workedMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="관리자에게 보내기" icon="📤">
        <p className="muted small" style={{ marginTop: 0 }}>
          이 달 근무내역을 관리자에게 보냅니다. 보낸 뒤에도 다시 보내면 새 내용으로 바뀝니다.
        </p>
        <label className="field-label">함께 전할 말 (선택)</label>
        <textarea
          className="textarea"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="예: 9/14 는 대타로 나왔습니다"
          maxLength={200}
        />
        {mode !== "live" && (
          <div className="alert-item warn" style={{ marginTop: 10 }}>
            <span>!</span>
            <div>데모 모드에서는 보낼 수 없습니다.</div>
          </div>
        )}
        <button
          className="btn btn-primary btn-block btn-lg"
          style={{ marginTop: 12 }}
          disabled={sending || totals.workedDays === 0 || mode !== "live"}
          onClick={() => void send()}
        >
          {sending
            ? "보내는 중…"
            : mySubmission
              ? `${monthLabel(attendanceMonth)} 근무내역 다시 보내기`
              : `${monthLabel(attendanceMonth)} 근무내역 보내기`}
        </button>
      </Card>
    </div>
  );
}
