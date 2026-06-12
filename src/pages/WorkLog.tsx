import { useState, useEffect } from "react";
import { useStore } from "../store";
import { Card, TimeQuick, ChipSelect, Badge } from "../components/ui";
import {
  TODAY_DOW, TODAY_STR, CHECKLIST_TEMPLATE,
  minutes, toTime, durationH,
} from "../data";
import { isMonthlyEmployee, payBasisLabel } from "../lib/payroll";

export default function WorkLog() {
  const { shifts, records, addRecord, showToast, currentEmployee, loading } = useStore();
  const me = currentEmployee;
  const plan = shifts.find((s) => s.empId === me?.id && s.day === TODAY_DOW);
  const planStart = plan && !plan.off ? plan.start! : "10:00";
  const planEnd = plan && !plan.off ? plan.end! : "15:00";

  const [start, setStart] = useState(planStart);
  const [end, setEnd] = useState(planEnd);
  const [breakMin, setBreakMin] = useState(plan?.breakMin ?? 30);
  const [touched, setTouched] = useState(false);
  const [note, setNote] = useState("");
  const [handover, setHandover] = useState("");
  const [checks, setChecks] = useState<boolean[]>(CHECKLIST_TEMPLATE.map(() => false));
  const [submitted, setSubmitted] = useState(false);

  // Firestore에서 근무표가 늦게 도착해도, 사용자가 건드리기 전이면 기본값 동기화
  useEffect(() => {
    if (!touched) {
      setStart(planStart);
      setEnd(planEnd);
      setBreakMin(plan?.breakMin ?? 30);
    }
  }, [planStart, planEnd, plan?.breakMin, touched]);

  const touch = <T,>(setter: (v: T) => void) => (v: T) => {
    setTouched(true);
    setter(v);
  };

  const startDiff = minutes(start) - minutes(planStart);
  const endDiff = minutes(end) - minutes(planEnd);
  const actualH = durationH(start, end, breakMin);

  const startPresets = [0, 10, 15, 30].map((d) => toTime(minutes(planStart) + d));
  const startLabels = ["정시", "10분 늦음", "15분 늦음", "30분 늦음"];
  const endPresets = [0, 15, 30, 60].map((d) => toTime(minutes(planEnd) + d));
  const endLabels = ["정시", "15분 연장", "30분 연장", "1시간 연장"];

  const diffBadge = (diff: number) =>
    diff === 0 ? <Badge tone="green">정시</Badge>
      : diff > 0 ? <Badge tone="amber">+{diff}분</Badge>
      : <Badge tone="blue">{diff}분</Badge>;

  const myRecent = records
    .filter((r) => r.empId === me?.id)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 4);

  if (!me) {
    return (
      <Card>
        <div className="muted" style={{ textAlign: "center", padding: "30px 0" }}>
          {loading
            ? "직원 정보를 불러오는 중..."
            : "계정에 연결된 직원 정보가 없습니다. 관리자에게 문의해주세요."}
        </div>
      </Card>
    );
  }

  if (isMonthlyEmployee(me)) {
    return (
      <div className="grid grid-main-side">
        <div className="stack">
          <Card title="정직원 고정 근무" icon="🕘">
            <div className="alert-item info">
              <span>💼</span>
              <div>
                정직원은 월급 기준으로 급여를 계산합니다
                <div className="desc">매일 같은 시간 근무라 근무시간 기록을 급여에 반영하지 않습니다.</div>
              </div>
            </div>
            <div className="pay-line"><span className="k">급여기준</span><span className="v">{payBasisLabel(me)}</span></div>
            <div className="pay-line"><span className="k">기준 근무</span><span className="v">{me.standardStart ?? "고정"} ~ {me.standardEnd ?? "고정"}</span></div>
            <div className="pay-line total"><span className="k">기록 방식</span><span className="v">예외만 관리자에게 전달</span></div>
          </Card>
        </div>
        <div className="stack side-panel">
          <Card title="예외 기록 안내" icon="📝">
            <p className="muted small" style={{ margin: 0 }}>
              지각, 조퇴, 결근, 추가수당, 차감처럼 급여에 반영할 예외가 있을 때만 관리자에게 전달하면 됩니다.
            </p>
          </Card>
        </div>
      </div>
    );
  }

  const submit = (asDraft: boolean) => {
    addRecord({
      id: Date.now(), empId: me.id, date: TODAY_STR,
      planStart, planEnd, actualStart: start, actualEnd: end,
      breakMin, note, handover, checklist: checks,
      status: asDraft ? "미작성" : "승인대기",
    });
    if (!asDraft) setSubmitted(true);
    showToast(asDraft ? "임시 저장되었습니다" : "근무기록이 제출되었습니다");
  };

  return (
    <>
      {/* 오늘 예정 근무 요약 */}
      <Card>
        <div className="spread" style={{ flexWrap: "wrap", gap: 12 }}>
          <div>
            <div className="muted small bold">오늘의 예정 근무</div>
            <div className="time-display" style={{ marginTop: 2 }}>
              {planStart} ~ {planEnd}
              <span className="muted" style={{ fontSize: 14, fontWeight: 600, marginLeft: 10 }}>
                휴게 {plan?.breakMin ?? 30}분
              </span>
            </div>
          </div>
          <div className="row">
            <div style={{ textAlign: "right" }}>
              <div className="muted small">기록 기준 실근무</div>
              <div className="bold" style={{ fontSize: 19 }}>{actualH}시간</div>
            </div>
            {submitted
              ? <Badge tone="green">제출 완료</Badge>
              : <Badge tone="amber">작성 전</Badge>}
          </div>
        </div>
      </Card>

      <div className="grid grid-main-side">
        <div className="stack">
          {/* 시간 입력 */}
          <Card title="시간 입력" icon="⏱️">
            <div className="stack" style={{ gap: 22 }}>
              <TimeQuick
                label="출근 시간"
                value={start}
                onChange={touch(setStart)}
                presets={startPresets}
                presetLabels={startLabels}
                badge={diffBadge(startDiff)}
              />
              <TimeQuick
                label="퇴근 시간"
                value={end}
                onChange={touch(setEnd)}
                presets={endPresets}
                presetLabels={endLabels}
                badge={diffBadge(endDiff)}
              />
              <div>
                <span className="field-label">휴게시간</span>
                <ChipSelect
                  options={[0, 30, 60, 90]}
                  value={breakMin}
                  onChange={touch(setBreakMin)}
                  format={(m) => (m === 0 ? "없음" : `${m}분`)}
                />
                <p className="muted small" style={{ margin: "8px 0 0" }}>
                  ⓘ 휴게시간은 근무시간에서 자동 차감되어 계산됩니다.
                </p>
              </div>
            </div>
          </Card>

          {/* 체크리스트 */}
          <Card title="오늘 업무 체크리스트" icon="✅" action={
            <span className="muted small">{checks.filter(Boolean).length}/{checks.length} 완료</span>
          }>
            {CHECKLIST_TEMPLATE.map((c, i) => (
              <div
                key={i}
                className={`check-item ${checks[i] ? "done" : ""}`}
                onClick={() => setChecks((p) => p.map((v, j) => (j === i ? !v : v)))}
              >
                <span className="checkbox">{checks[i] ? "✓" : ""}</span>
                {c}
              </div>
            ))}
          </Card>
        </div>

        <div className="stack side-panel">
          {/* 업무 메모 */}
          <Card title="업무 메모" icon="📝">
            <label className="field-label">특이사항</label>
            <textarea
              className="textarea"
              placeholder="특이사항을 입력해주세요. (선택)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={100}
            />
            <div className="muted small" style={{ textAlign: "right" }}>{note.length}/100</div>

            <label className="field-label" style={{ marginTop: 8 }}>전달사항</label>
            <textarea
              className="textarea"
              placeholder="다음 근무자에게 전달할 내용을 입력해주세요. (선택)"
              value={handover}
              onChange={(e) => setHandover(e.target.value)}
              maxLength={100}
            />
            <div className="muted small" style={{ textAlign: "right" }}>{handover.length}/100</div>
          </Card>

          {/* 최근 근무기록 */}
          <Card title="최근 근무기록" icon="🗂️">
            {myRecent.map((r) => (
              <div className="list-row" key={r.id}>
                <div style={{ flex: 1 }}>
                  <div className="bold small">{r.date.slice(5).replace("-", "/")}</div>
                  <div className="muted small num">{r.actualStart}–{r.actualEnd} · 휴게 {r.breakMin}분</div>
                </div>
                <Badge tone={r.status === "승인완료" ? "green" : r.status === "승인대기" ? "amber" : "gray"}>
                  {r.status}
                </Badge>
              </div>
            ))}
            {myRecent.length === 0 && (
              <div className="muted small" style={{ textAlign: "center", padding: "12px 0" }}>
                아직 근무기록이 없습니다
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* 저장/제출 */}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-outline btn-lg" onClick={() => submit(true)}>임시 저장</button>
        <button className="btn btn-primary btn-lg" disabled={submitted} onClick={() => submit(false)}>
          ✓ 근무기록 저장 및 제출
        </button>
      </div>
    </>
  );
}
