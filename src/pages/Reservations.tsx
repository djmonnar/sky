import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Card, StatusBadge, ChipSelect, Badge } from "../components/ui";
import {
  Reservation, ResvStatus, RESV_STATUSES, SEATS, Seat,
  TODAY_STR, DOW_KO, TODAY_DOW,
} from "../data";

type Filter = "전체" | "점심" | "저녁" | "주의";

const QUICK_STATUS: { s: ResvStatus; cls: string; ic: string }[] = [
  { s: "방문완료", cls: "btn-primary", ic: "✓" },
  { s: "취소", cls: "btn-danger", ic: "✕" },
  { s: "노쇼", cls: "btn-outline", ic: "👻" },
];

const EMPTY_FORM: Omit<Reservation, "id"> = {
  date: TODAY_STR, time: "18:00", name: "", phone: "", people: 2,
  seat: "홀A", status: "예약확정", writer: "김민수",
  createdAt: "2026-06-12 10:30",
};

export default function Reservations() {
  const { reservations, upsertReservation, showToast, role } = useStore();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("전체");
  const [selId, setSelId] = useState<number | null>(null);
  const [memo, setMemo] = useState("");
  const [openId, setOpenId] = useState<number | null>(null); // 모바일 아코디언
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const list = useMemo(() => {
    let l = [...reservations].sort((a, b) => a.time.localeCompare(b.time));
    if (query) l = l.filter((r) => r.name.includes(query) || r.phone.includes(query));
    if (filter === "점심") l = l.filter((r) => r.time < "16:00");
    if (filter === "저녁") l = l.filter((r) => r.time >= "16:00");
    if (filter === "주의") l = l.filter((r) => r.status === "확인전화필요" || r.status === "단체" || r.people >= 6);
    return l;
  }, [reservations, query, filter]);

  const sel = reservations.find((r) => r.id === selId) ?? null;

  const stats = useMemo(() => ({
    total: reservations.filter((r) => r.status !== "취소" && r.status !== "노쇼").length,
    done: reservations.filter((r) => r.status === "방문완료").length,
    call: reservations.filter((r) => r.status === "확인전화필요").length,
    bad: reservations.filter((r) => r.status === "취소" || r.status === "노쇼").length,
  }), [reservations]);

  const select = (r: Reservation) => {
    setSelId(r.id);
    setMemo(r.memo ?? "");
  };

  const changeStatus = (r: Reservation, status: ResvStatus) => {
    upsertReservation({ ...r, status });
    showToast(`'${r.name}' 예약이 ${status} 처리되었습니다`);
  };

  const saveMemo = (r: Reservation) => {
    upsertReservation({ ...r, memo });
    showToast("메모가 저장되었습니다");
  };

  const submitForm = () => {
    if (!form.name || !form.phone) { showToast("예약자명과 연락처를 입력해주세요"); return; }
    upsertReservation({ ...form, id: Date.now() });
    setShowForm(false);
    setForm(EMPTY_FORM);
    showToast("예약이 등록되었습니다");
  };

  const isWarn = (r: Reservation) =>
    r.status === "확인전화필요" || r.status === "단체" || r.people >= 6;

  return (
    <>
      {/* 상단: 날짜/검색/등록 */}
      <div className="spread" style={{ flexWrap: "wrap", gap: 10 }}>
        <div className="row">
          <input type="date" className="input" style={{ width: 150 }} defaultValue={TODAY_STR} />
          <span className="bold hide-mobile">{DOW_KO[TODAY_DOW]}요일</span>
        </div>
        <div className="row" style={{ flex: 1, justifyContent: "flex-end" }}>
          <div className="search-wrap">
            <span className="search-ic">🔍</span>
            <input
              className="input"
              placeholder="예약자명 또는 연락처 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
            ＋ 예약 등록
          </button>
        </div>
      </div>

      {/* 통계 요약 */}
      <div className="grid grid-4">
        <div className="stat-card">
          <div><div className="stat-label">전체 예약</div><div className="stat-value">{stats.total}<span className="unit">건</span></div></div>
          <div className="stat-icon">📋</div>
        </div>
        <div className="stat-card">
          <div><div className="stat-label">방문완료</div><div className="stat-value">{stats.done}<span className="unit">건</span></div></div>
          <div className="stat-icon">✅</div>
        </div>
        <div className="stat-card">
          <div><div className="stat-label">확인전화 필요</div><div className="stat-value">{stats.call}<span className="unit">건</span></div></div>
          <div className="stat-icon amber">📞</div>
        </div>
        <div className="stat-card">
          <div><div className="stat-label">취소·노쇼</div><div className="stat-value">{stats.bad}<span className="unit">건</span></div></div>
          <div className="stat-icon red">⚠️</div>
        </div>
      </div>

      {/* 신규 예약 폼 */}
      {showForm && (
        <Card title="새 예약 등록 (전화예약 입력)" icon="📞">
          <div className="grid grid-3" style={{ gap: 12 }}>
            <div>
              <label className="field-label">예약자명 *</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="홍길동" />
            </div>
            <div>
              <label className="field-label">연락처 *</label>
              <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="010-0000-0000" />
            </div>
            <div>
              <label className="field-label">예약일</label>
              <input type="date" className="input" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            <label className="field-label">예약 시간</label>
            <ChipSelect
              options={["11:00", "11:30", "12:00", "12:30", "13:00", "17:30", "18:00", "18:30", "19:00", "19:30", "20:00"]}
              value={form.time}
              onChange={(time) => setForm({ ...form, time })}
            />
          </div>
          <div style={{ marginTop: 14 }}>
            <label className="field-label">인원</label>
            <ChipSelect
              options={[1, 2, 3, 4, 5, 6, 8, 10, 12]}
              value={form.people}
              onChange={(people) => setForm({ ...form, people, status: people >= 8 ? "단체" : form.status })}
              format={(n) => `${n}명`}
            />
          </div>
          <div style={{ marginTop: 14 }}>
            <label className="field-label">좌석</label>
            <ChipSelect options={SEATS} value={form.seat} onChange={(seat) => setForm({ ...form, seat: seat as Seat })} />
          </div>
          <div style={{ marginTop: 14 }}>
            <label className="field-label">요청사항</label>
            <input className="input" value={form.request ?? ""} onChange={(e) => setForm({ ...form, request: e.target.value })} placeholder="유아의자, 창가 선호 등" />
          </div>
          <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
            <button className="btn btn-outline" onClick={() => setShowForm(false)}>닫기</button>
            <button className="btn btn-primary" onClick={submitForm}>예약 저장</button>
          </div>
        </Card>
      )}

      {/* 필터 칩 */}
      <div className="filter-chips">
        {(["전체", "점심", "저녁", "주의"] as Filter[]).map((f) => (
          <button key={f} className={`fchip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>
            {f}
            {f === "주의" && <span className="cnt">{reservations.filter(isWarn).length}</span>}
          </button>
        ))}
      </div>

      <div className="grid grid-main-side">
        {/* 데스크톱 테이블 */}
        <Card className="hide-mobile">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>시간</th><th>예약자</th><th>연락처</th><th>인원</th><th>좌석</th><th>상태</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className={selId === r.id ? "sel" : ""} onClick={() => select(r)}>
                    <td className="bold num">{r.time}</td>
                    <td className="bold">{r.name}{isWarn(r) && " ⚠️"}</td>
                    <td className="muted num">{r.phone}</td>
                    <td className="num">{r.people}명</td>
                    <td>{r.seat}</td>
                    <td><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
                {list.length === 0 && (
                  <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 28 }}>조건에 맞는 예약이 없습니다</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* 모바일 아코디언 리스트 */}
        <div className="stack hide-desktop" style={{ gap: 10 }}>
          {list.map((r) => {
            const open = openId === r.id;
            return (
              <div key={r.id} className={`resv-card ${isWarn(r) ? "hl" : ""}`}>
                <button className="resv-card-head" onClick={() => setOpenId(open ? null : r.id)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="spread">
                      <span className="list-time" style={{ fontSize: 17 }}>{r.time}</span>
                      <span className="row" style={{ gap: 6 }}>
                        {r.people >= 6 && r.status !== "단체" && <Badge tone="orange">{r.people}명</Badge>}
                        <StatusBadge status={r.status} />
                      </span>
                    </div>
                    <div className="bold" style={{ fontSize: 15, marginTop: 5 }}>
                      {r.name} <span className="muted small" style={{ fontWeight: 500 }}>· {r.people}명 · {r.seat}</span>
                    </div>
                    {r.request && <div className="muted small" style={{ marginTop: 1 }}>{r.request}</div>}
                  </div>
                  <span className={`chev ${open ? "open" : ""}`}>▾</span>
                </button>
                {open && (
                  <div className="resv-card-body">
                    <div className="detail-line">
                      <span className="k">연락처</span>
                      <a className="v" href={`tel:${r.phone}`} style={{ color: "var(--green-700)" }}>
                        📞 {r.phone}
                      </a>
                    </div>
                    <div className="detail-line"><span className="k">인원</span><span className="v">{r.people}명</span></div>
                    <div className="detail-line"><span className="k">좌석</span><span className="v">{r.seat}</span></div>
                    <div className="detail-line"><span className="k">요청사항</span><span className="v">{r.request ?? "—"}</span></div>
                    <div className="detail-line"><span className="k">작성자</span><span className="v">{r.writer}</span></div>
                    <div className="detail-line"><span className="k">접수일시</span><span className="v small">{r.createdAt}</span></div>
                    <div className="resv-actions">
                      {QUICK_STATUS.map((q) => (
                        <button key={q.s} className={`btn ${q.cls}`} onClick={() => changeStatus(r, q.s)}>
                          {q.ic} {q.s}
                        </button>
                      ))}
                    </div>
                    <textarea
                      className="textarea" style={{ marginTop: 10, minHeight: 56 }}
                      placeholder="메모 입력 (선결제, 변동사항 등)"
                      defaultValue={r.memo}
                      onBlur={(e) => upsertReservation({ ...r, memo: e.target.value })}
                    />
                    <button className="btn btn-soft btn-block" style={{ marginTop: 8 }} onClick={() => showToast("메모가 저장되었습니다")}>
                      💾 메모 저장
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {list.length === 0 && (
            <Card><div className="muted" style={{ textAlign: "center", padding: "20px 0" }}>조건에 맞는 예약이 없습니다</div></Card>
          )}
        </div>

        {/* 데스크톱 상세 패널 */}
        <div className="side-panel hide-mobile">
          {sel ? (
            <Card title={`${sel.time} · ${sel.name}`} action={<StatusBadge status={sel.status} />}>
              <div className="detail-line"><span className="k">연락처</span><span className="v">{sel.phone}</span></div>
              <div className="detail-line"><span className="k">인원</span><span className="v">{sel.people}명</span></div>
              <div className="detail-line"><span className="k">좌석</span><span className="v">{sel.seat}</span></div>
              <div className="detail-line"><span className="k">요청사항</span><span className="v">{sel.request ?? "—"}</span></div>
              <div className="detail-line"><span className="k">작성자</span><span className="v">{sel.writer}</span></div>
              <div className="detail-line"><span className="k">접수일시</span><span className="v small">{sel.createdAt}</span></div>

              <label className="field-label" style={{ marginTop: 14 }}>상태 변경</label>
              <div className="chip-row">
                {RESV_STATUSES.map((s) => (
                  <button key={s} className={`chip ${sel.status === s ? "on" : ""}`} style={{ padding: "6px 11px", fontSize: 12.5, minHeight: 32 }} onClick={() => changeStatus(sel, s)}>
                    {s}
                  </button>
                ))}
              </div>

              <label className="field-label" style={{ marginTop: 14 }}>메모</label>
              <textarea className="textarea" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="메모를 입력하세요 (선결제, 변동사항 등)" />
              <button className="btn btn-primary btn-block" style={{ marginTop: 10 }} onClick={() => saveMemo(sel)}>
                💾 메모 저장
              </button>
            </Card>
          ) : (
            <Card>
              <div className="muted" style={{ textAlign: "center", padding: "34px 0" }}>
                좌측 목록에서 예약을 선택하면<br />상세 정보가 표시됩니다
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
