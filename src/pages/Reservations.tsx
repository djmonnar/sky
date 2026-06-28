import { useMemo, useState } from "react";
import { useStore } from "../store";
import { Card, StatusBadge, Badge } from "../components/ui";
import {
  Reservation, ResvStatus, RESV_STATUSES, SEATS, Seat,
  TODAY_STR, DOW_KO, TODAY_DOW,
} from "../data";

type Filter = "전체" | "오전" | "오후" | "주의";
type TimePeriod = "AM" | "PM";

const QUICK_STATUS: { s: ResvStatus; cls: string; ic: string }[] = [
  { s: "방문완료", cls: "btn-primary", ic: "✓" },
  { s: "취소", cls: "btn-danger", ic: "×" },
  { s: "노쇼", cls: "btn-outline", ic: "!" },
];

const EMPTY_FORM: Omit<Reservation, "id"> = {
  date: TODAY_STR,
  time: "18:00",
  name: "",
  phone: "",
  people: 2,
  seat: "홀A",
  status: "예약확정",
  writer: "직원",
  createdAt: "",
};

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function splitTime(time: string): { period: TimePeriod; clock: string } {
  const [hh = "18", mm = "00"] = time.split(":");
  const hour = Number(hh);
  const period: TimePeriod = hour < 12 ? "AM" : "PM";
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return { period, clock: `${displayHour}:${mm.padStart(2, "0")}` };
}

function to24Hour(period: TimePeriod, raw: string): string | null {
  const compact = raw.trim().replace(/[.\s]/g, ":");
  const match = compact.match(/^(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "00");
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  if (period === "AM" && hour === 12) hour = 0;
  if (period === "PM" && hour < 12) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export default function Reservations() {
  const {
    reservations, upsertReservation, showToast, mode, profile, currentEmployee,
  } = useStore();
  const writerName =
    mode === "live" ? profile?.name ?? "직원" : currentEmployee?.name ?? "직원";
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("전체");
  const [selectedDate, setSelectedDate] = useState(TODAY_STR);
  const [selId, setSelId] = useState<number | null>(null);
  const [memo, setMemo] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const initialTime = splitTime(EMPTY_FORM.time);
  const [formPeriod, setFormPeriod] = useState<TimePeriod>(initialTime.period);
  const [formClock, setFormClock] = useState(initialTime.clock);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const dayReservations = reservations.filter((r) => r.date === selectedDate);
  const list = useMemo(() => {
    let l = [...dayReservations].sort((a, b) => a.time.localeCompare(b.time));
    const q = query.trim();
    if (q) l = l.filter((r) => r.name.includes(q) || r.phone.includes(q));
    if (filter === "오전") l = l.filter((r) => r.time < "12:00");
    if (filter === "오후") l = l.filter((r) => r.time >= "12:00");
    if (filter === "주의") {
      l = l.filter((r) => r.status === "확인전화필요" || r.status === "단체" || r.people >= 6);
    }
    return l;
  }, [dayReservations, query, filter]);

  const sel = reservations.find((r) => r.id === selId) ?? null;
  const visibleIds = list.map((r) => r.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const selectedReservations = reservations.filter((r) => selectedIds.includes(r.id));

  const stats = useMemo(() => ({
    total: dayReservations.filter((r) => r.status !== "취소" && r.status !== "노쇼").length,
    done: dayReservations.filter((r) => r.status === "방문완료").length,
    call: dayReservations.filter((r) => r.status === "확인전화필요").length,
    bad: dayReservations.filter((r) => r.status === "취소" || r.status === "노쇼").length,
  }), [dayReservations]);

  const isWarn = (r: Reservation) =>
    r.status === "확인전화필요" || r.status === "단체" || r.people >= 6;

  const select = (r: Reservation) => {
    setSelId(r.id);
    setMemo(r.memo ?? "");
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (allVisibleSelected) return prev.filter((id) => !visibleIds.includes(id));
      return Array.from(new Set([...prev, ...visibleIds]));
    });
  };

  const resetForm = () => {
    const next = { ...EMPTY_FORM, date: selectedDate, writer: writerName, createdAt: nowStamp() };
    const parsed = splitTime(next.time);
    setEditingId(null);
    setForm(next);
    setFormPeriod(parsed.period);
    setFormClock(parsed.clock);
  };

  const openCreateForm = () => {
    resetForm();
    setShowForm(true);
  };

  const openEditForm = (r: Reservation) => {
    const parsed = splitTime(r.time);
    setEditingId(r.id);
    setForm({ ...r });
    setFormPeriod(parsed.period);
    setFormClock(parsed.clock);
    setShowForm(true);
  };

  const editSelected = () => {
    if (selectedReservations.length !== 1) {
      showToast("수정할 예약을 1건만 선택해주세요");
      return;
    }
    openEditForm(selectedReservations[0]);
  };

  const changeStatus = (r: Reservation, status: ResvStatus) => {
    upsertReservation({ ...r, status });
    showToast(`'${r.name}' 예약을 ${status} 처리했습니다`);
  };

  const bulkStatus = (status: ResvStatus) => {
    if (selectedReservations.length === 0) {
      showToast("처리할 예약을 선택해주세요");
      return;
    }
    selectedReservations.forEach((r) => upsertReservation({ ...r, status }));
    showToast(`${selectedReservations.length}건을 ${status} 처리했습니다`);
  };

  const saveMemo = (r: Reservation) => {
    upsertReservation({ ...r, memo });
    showToast("메모가 저장되었습니다");
  };

  const submitForm = () => {
    const time = to24Hour(formPeriod, formClock);
    if (!form.name.trim() || !form.phone.trim()) {
      showToast("예약자명과 연락처를 입력해주세요");
      return;
    }
    if (!time) {
      showToast("예약 시간을 예: 7:30 형식으로 입력해주세요");
      return;
    }
    const next: Reservation = {
      ...form,
      id: editingId ?? Date.now(),
      date: form.date || selectedDate,
      time,
      name: form.name.trim(),
      phone: form.phone.trim(),
      writer: form.writer || writerName,
      createdAt: form.createdAt || nowStamp(),
      status: form.people >= 8 && form.status === "예약확정" ? "단체" : form.status,
    };
    upsertReservation(next);
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSelectedIds((prev) => prev.filter((id) => id !== next.id));
    showToast(editingId ? "예약을 수정했습니다" : "예약을 등록했습니다");
  };

  return (
    <>
      <div className="spread" style={{ flexWrap: "wrap", gap: 10 }}>
        <div className="row">
          <input
            type="date"
            className="input"
            style={{ width: 150 }}
            value={selectedDate}
            onChange={(e) => {
              setSelectedDate(e.target.value);
              setSelectedIds([]);
            }}
          />
          <span className="bold hide-mobile">{selectedDate === TODAY_STR ? DOW_KO[TODAY_DOW] : "선택일"}요일</span>
        </div>
        <div className="row" style={{ flex: 1, justifyContent: "flex-end" }}>
          <div className="search-wrap">
            <span className="search-ic">⌕</span>
            <input
              className="input"
              placeholder="예약자명 또는 연락처 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" onClick={openCreateForm}>
            ＋ 예약 등록
          </button>
        </div>
      </div>

      <div className="grid grid-4">
        <div className="stat-card">
          <div><div className="stat-label">전체 예약</div><div className="stat-value">{stats.total}<span className="unit">건</span></div></div>
          <div className="stat-icon">📋</div>
        </div>
        <div className="stat-card">
          <div><div className="stat-label">방문완료</div><div className="stat-value">{stats.done}<span className="unit">건</span></div></div>
          <div className="stat-icon">✓</div>
        </div>
        <div className="stat-card">
          <div><div className="stat-label">확인전화 필요</div><div className="stat-value">{stats.call}<span className="unit">건</span></div></div>
          <div className="stat-icon amber">☎</div>
        </div>
        <div className="stat-card">
          <div><div className="stat-label">취소·노쇼</div><div className="stat-value">{stats.bad}<span className="unit">건</span></div></div>
          <div className="stat-icon red">!</div>
        </div>
      </div>

      {showForm && (
        <Card title={editingId ? "예약 수정" : "새 예약 등록"} icon="☎">
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

          <div className="grid grid-3" style={{ gap: 12, marginTop: 14 }}>
            <div>
              <label className="field-label">오전/오후</label>
              <div className="segmented">
                <button className={formPeriod === "AM" ? "on" : ""} onClick={() => setFormPeriod("AM")}>오전</button>
                <button className={formPeriod === "PM" ? "on" : ""} onClick={() => setFormPeriod("PM")}>오후</button>
              </div>
            </div>
            <div>
              <label className="field-label">시간 직접입력</label>
              <input className="input" value={formClock} onChange={(e) => setFormClock(e.target.value)} placeholder="예: 7:30" inputMode="numeric" />
            </div>
            <div>
              <label className="field-label">상태</label>
              <select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ResvStatus })}>
                {RESV_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-3" style={{ gap: 12, marginTop: 14 }}>
            <div>
              <label className="field-label">인원</label>
              <input className="input" type="number" min={1} value={form.people} onChange={(e) => setForm({ ...form, people: Number(e.target.value) })} />
            </div>
            <div>
              <label className="field-label">좌석</label>
              <select className="select" value={form.seat} onChange={(e) => setForm({ ...form, seat: e.target.value as Seat })}>
                {SEATS.map((seat) => <option key={seat} value={seat}>{seat}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">작성자</label>
              <input className="input" value={form.writer} onChange={(e) => setForm({ ...form, writer: e.target.value })} />
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <label className="field-label">요청사항</label>
            <input className="input" value={form.request ?? ""} onChange={(e) => setForm({ ...form, request: e.target.value })} placeholder="유아의자, 창가 선호 등" />
          </div>
          <div style={{ marginTop: 14 }}>
            <label className="field-label">메모</label>
            <textarea className="textarea" value={form.memo ?? ""} onChange={(e) => setForm({ ...form, memo: e.target.value })} placeholder="내부 메모" />
          </div>
          <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
            <button className="btn btn-outline" onClick={() => { setShowForm(false); setEditingId(null); }}>닫기</button>
            <button className="btn btn-primary" onClick={submitForm}>{editingId ? "수정 저장" : "예약 저장"}</button>
          </div>
        </Card>
      )}

      <div className="filter-chips">
        {(["전체", "오전", "오후", "주의"] as Filter[]).map((f) => (
          <button key={f} className={`fchip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>
            {f}
            {f === "주의" && <span className="cnt">{dayReservations.filter(isWarn).length}</span>}
          </button>
        ))}
      </div>

      <div className="bulk-bar">
        <label className="check-row">
          <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} />
          <span>전체선택</span>
        </label>
        <span className="muted small">선택 {selectedIds.length}건</span>
        <button className="btn btn-soft btn-sm" onClick={() => bulkStatus("방문완료")} disabled={selectedIds.length === 0}>방문완료</button>
        <button className="btn btn-danger btn-sm" onClick={() => bulkStatus("취소")} disabled={selectedIds.length === 0}>취소</button>
        <button className="btn btn-outline btn-sm" onClick={editSelected} disabled={selectedIds.length !== 1}>수정</button>
        <button className="btn btn-outline btn-sm" onClick={() => setSelectedIds([])} disabled={selectedIds.length === 0}>선택해제</button>
      </div>

      <div className="grid grid-main-side">
        <Card className="hide-mobile">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 42 }}></th>
                  <th>시간</th><th>예약자</th><th>연락처</th><th>인원</th><th>좌석</th><th>상태</th><th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className={selId === r.id ? "sel" : ""} onClick={() => select(r)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => toggleSelected(r.id)} />
                    </td>
                    <td className="bold num">{r.time}</td>
                    <td className="bold">{r.name}{isWarn(r) && " !"}</td>
                    <td className="muted num">{r.phone}</td>
                    <td className="num">{r.people}명</td>
                    <td>{r.seat}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-outline btn-sm" onClick={() => openEditForm(r)}>수정</button>
                    </td>
                  </tr>
                ))}
                {list.length === 0 && (
                  <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 28 }}>조건에 맞는 예약이 없습니다</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="stack hide-desktop" style={{ gap: 10 }}>
          {list.map((r) => {
            const open = openId === r.id;
            return (
              <div key={r.id} className={`resv-card ${isWarn(r) ? "hl" : ""}`}>
                <div className="resv-card-select">
                  <label className="check-row">
                    <input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => toggleSelected(r.id)} />
                    <span>선택</span>
                  </label>
                  <button className="btn btn-outline btn-sm" onClick={() => openEditForm(r)}>수정</button>
                </div>
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
                  <span className={`chev ${open ? "open" : ""}`}>›</span>
                </button>
                {open && (
                  <div className="resv-card-body">
                    <div className="detail-line">
                      <span className="k">연락처</span>
                      <a className="v" href={`tel:${r.phone}`} style={{ color: "var(--green-700)" }}>☎ {r.phone}</a>
                    </div>
                    <div className="detail-line"><span className="k">요청사항</span><span className="v">{r.request ?? "-"}</span></div>
                    <div className="detail-line"><span className="k">작성자</span><span className="v">{r.writer}</span></div>
                    <div className="resv-actions">
                      {QUICK_STATUS.map((q) => (
                        <button key={q.s} className={`btn ${q.cls}`} onClick={() => changeStatus(r, q.s)}>
                          {q.ic} {q.s}
                        </button>
                      ))}
                    </div>
                    <textarea
                      className="textarea" style={{ marginTop: 10, minHeight: 56 }}
                      placeholder="메모 입력"
                      defaultValue={r.memo}
                      onBlur={(e) => upsertReservation({ ...r, memo: e.target.value })}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {list.length === 0 && (
            <Card><div className="muted" style={{ textAlign: "center", padding: "20px 0" }}>조건에 맞는 예약이 없습니다</div></Card>
          )}
        </div>

        <div className="side-panel hide-mobile">
          {sel ? (
            <Card title={`${sel.time} · ${sel.name}`} action={<StatusBadge status={sel.status} />}>
              <div className="detail-line"><span className="k">연락처</span><span className="v">{sel.phone}</span></div>
              <div className="detail-line"><span className="k">인원</span><span className="v">{sel.people}명</span></div>
              <div className="detail-line"><span className="k">좌석</span><span className="v">{sel.seat}</span></div>
              <div className="detail-line"><span className="k">요청사항</span><span className="v">{sel.request ?? "-"}</span></div>
              <div className="detail-line"><span className="k">작성자</span><span className="v">{sel.writer}</span></div>
              <div className="detail-line"><span className="k">접수일시</span><span className="v small">{sel.createdAt}</span></div>

              <button className="btn btn-outline btn-block" style={{ marginTop: 12 }} onClick={() => openEditForm(sel)}>
                예약 수정
              </button>

              <label className="field-label" style={{ marginTop: 14 }}>상태 변경</label>
              <div className="chip-row">
                {RESV_STATUSES.map((s) => (
                  <button key={s} className={`chip ${sel.status === s ? "on" : ""}`} style={{ padding: "6px 11px", fontSize: 12.5, minHeight: 32 }} onClick={() => changeStatus(sel, s)}>
                    {s}
                  </button>
                ))}
              </div>

              <label className="field-label" style={{ marginTop: 14 }}>메모</label>
              <textarea className="textarea" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="메모를 입력하세요" />
              <button className="btn btn-primary btn-block" style={{ marginTop: 10 }} onClick={() => saveMemo(sel)}>
                메모 저장
              </button>
            </Card>
          ) : (
            <Card>
              <div className="muted" style={{ textAlign: "center", padding: "34px 0" }}>
                목록에서 예약을 선택하면<br />상세 정보가 표시됩니다
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
