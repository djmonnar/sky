import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useStore } from "../store";
import { Card, Badge, StatCard } from "../components/ui";
import EmploymentContractBuilder from "../components/EmploymentContractBuilder";
import { salaryTypeLabel, employmentLabel } from "../lib/payroll";
import type { Employee, EmploymentType, Role, SalaryType, WeeklyWorkSchedule, WorkDayKey } from "../data/types";

const WORK_DAYS: { key: WorkDayKey; label: string; short: string }[] = [
  { key: "mon", label: "월요일", short: "월" },
  { key: "tue", label: "화요일", short: "화" },
  { key: "wed", label: "수요일", short: "수" },
  { key: "thu", label: "목요일", short: "목" },
  { key: "fri", label: "금요일", short: "금" },
  { key: "sat", label: "토요일", short: "토" },
  { key: "sun", label: "일요일", short: "일" },
];
const WORK_TIME_PRESETS = [
  { label: "오전", start: "10:00", end: "15:00" },
  { label: "오후", start: "17:00", end: "22:00" },
  { label: "풀타임", start: "10:00", end: "22:00" },
];

function defaultWeeklySchedule(): WeeklyWorkSchedule {
  return Object.fromEntries(WORK_DAYS.map(({ key }) => [key, { useDefault: true }])) as WeeklyWorkSchedule;
}

function normalizeWeeklySchedule(schedule?: WeeklyWorkSchedule): WeeklyWorkSchedule {
  const next = defaultWeeklySchedule();
  WORK_DAYS.forEach(({ key }) => {
    next[key] = { ...next[key], ...(schedule?.[key] ?? {}) };
  });
  return next;
}

function workTimeSummary(employee: Employee): string | null {
  if (employee.employmentType !== "fullTime") return null;
  const base = employee.standardStart && employee.standardEnd
    ? `${employee.standardStart}~${employee.standardEnd}`
    : "근무시간 미설정";
  if (!employee.weeklyScheduleEnabled || !employee.weeklySchedule) return base;
  const schedule = normalizeWeeklySchedule(employee.weeklySchedule);
  const exceptions = WORK_DAYS.filter(({ key }) => {
    const day = schedule[key];
    return day && (day.off || day.useDefault === false);
  }).map(({ key, short }) => {
    const day = schedule[key];
    if (day?.off) return `${short} 휴무`;
    return `${short} ${day?.start || employee.standardStart || "--:--"}~${day?.end || employee.standardEnd || "--:--"}`;
  });
  return exceptions.length > 0 ? `${base} · 예외 ${exceptions.join(", ")}` : base;
}

const ROLE_OPTIONS: Role[] = ["staff", "manager"];
const WORK_ROLE_OPTIONS = ["홀", "주방", "홀/주방"];

function roleLabel(role?: Role): string {
  if (role === "admin") return "관리자";
  if (role === "manager") return "매니저";
  return "실무자";
}

function roleTone(role?: Role): string {
  if (role === "admin") return "green";
  if (role === "manager") return "blue";
  return "gray";
}

function toNumber(value: string): number {
  return Number(value.replace(/[^0-9]/g, "")) || 0;
}

export default function EmployeeList() {
  const {
    employees, loading, userProfiles, updateUserRole,
    upsertEmployee, createEmployeeFromUserProfile, deleteEmployee, showToast, role,
  } = useStore();
  const [savingUid, setSavingUid] = useState<string | null>(null);
  const [linkingUid, setLinkingUid] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [draft, setDraft] = useState<Employee | null>(null);
  const [contractEmployee, setContractEmployee] = useState<Employee | null>(null);
  const [searchParams] = useSearchParams();
  const candidateName = searchParams.get("candidate")?.trim() ?? "";
  const signupUrl = `${window.location.origin}/signup`;
  const candidateSignupUrl = candidateName
    ? `${signupUrl}?name=${encodeURIComponent(candidateName)}`
    : signupUrl;

  const linked = employees.filter((e) => e.uid);
  const profilesByUid = useMemo(
    () => new Map(userProfiles.map((p) => [p.uid, p])),
    [userProfiles]
  );
  const isAdmin = role === "admin";
  const managerCount = userProfiles.filter((p) => p.role === "manager").length;
  const adminProfiles = userProfiles.filter((p) => p.role === "admin" && p.active !== false);
  const unlinkedAdminProfiles = adminProfiles.filter((profile) =>
    !employees.some((employee) =>
      employee.uid === profile.uid || (profile.employeeId !== undefined && employee.id === profile.employeeId)
    )
  );
  const allSelected = employees.length > 0 && employees.every((employee) => selectedIds.includes(employee.id));

  const changeRole = async (uid: string, nextRole: Role) => {
    setSavingUid(uid);
    try {
      await updateUserRole(uid, nextRole);
    } catch (e) {
      console.error(e);
      showToast("권한 변경에 실패했습니다. Firestore 권한을 확인해주세요.");
    } finally {
      setSavingUid(null);
    }
  };

  const addAdminToEmployees = async (uid: string) => {
    setLinkingUid(uid);
    try {
      await createEmployeeFromUserProfile(uid);
    } finally {
      setLinkingUid(null);
    }
  };

  const copySignupLink = async (url = signupUrl) => {
    try {
      await navigator.clipboard.writeText(url);
      showToast("회원가입 링크를 복사했습니다");
    } catch {
      showToast(url);
    }
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? [] : employees.map((employee) => employee.id));
  };

  const openEdit = (employee: Employee) => {
    setEditing(employee);
    setDraft({
      ...employee,
      weeklySchedule: normalizeWeeklySchedule(employee.weeklySchedule),
    });
    setContractEmployee(null);
  };

  const closeEdit = () => {
    setEditing(null);
    setDraft(null);
  };

  const openContract = (employee: Employee) => {
    setContractEmployee(employee);
    closeEdit();
    window.setTimeout(() => {
      document.querySelector(".contract-builder")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  const saveEmployee = () => {
    if (!draft) return;
    if (!draft.name.trim()) {
      showToast("직원 이름을 입력해주세요");
      return;
    }
    const normalized: Employee = {
      ...draft,
      name: draft.name.trim(),
      role: draft.role || "홀",
      hourly: draft.salaryType === "hourly" ? Number(draft.hourly ?? 0) : 0,
      monthlySalary: draft.salaryType === "monthly" ? Number(draft.monthlySalary ?? 0) : undefined,
      slotRate: draft.salaryType === "perSlot" ? Number(draft.slotRate ?? 0) : undefined,
      socialInsurance: draft.socialInsurance === true,
      phone: draft.phone?.trim(),
      address: draft.address?.trim(),
      residentRegistrationNumber: draft.residentRegistrationNumber?.trim(),
      bank: draft.bank?.trim(),
      account: draft.account?.trim(),
      standardStart: draft.employmentType === "fullTime" ? draft.standardStart : undefined,
      standardEnd: draft.employmentType === "fullTime" ? draft.standardEnd : undefined,
      weeklyScheduleEnabled: draft.employmentType === "fullTime" && draft.weeklyScheduleEnabled === true,
      weeklySchedule: draft.employmentType === "fullTime" && draft.weeklyScheduleEnabled === true
        ? normalizeWeeklySchedule(draft.weeklySchedule)
        : undefined,
    };
    upsertEmployee(normalized);
    closeEdit();
    showToast(`${normalized.name} 정보를 저장했습니다`);
  };

  const deleteSelected = () => {
    if (!isAdmin) {
      showToast("직원 삭제는 관리자만 가능합니다");
      return;
    }
    if (selectedIds.length === 0) {
      showToast("삭제할 직원을 선택해주세요");
      return;
    }
    const names = employees
      .filter((employee) => selectedIds.includes(employee.id))
      .map((employee) => employee.name)
      .join(", ");
    const ok = window.confirm(`${selectedIds.length}명의 직원을 완전 삭제할까요?\n${names}\n연결된 계정은 비활성화됩니다.`);
    if (!ok) return;
    selectedIds.forEach((id) => deleteEmployee(id));
    setSelectedIds([]);
    if (editing && selectedIds.includes(editing.id)) {
      closeEdit();
    }
    showToast("선택한 직원을 삭제했습니다");
  };

  const updateDraft = <K extends keyof Employee>(key: K, value: Employee[K]) => {
    if (!draft) return;
    setDraft({ ...draft, [key]: value });
  };

  const updateDraftPatch = (patch: Partial<Employee>) => {
    if (!draft) return;
    setDraft({ ...draft, ...patch });
  };

  const toggleWeeklySchedule = (enabled: boolean) => {
    if (!draft) return;
    setDraft({
      ...draft,
      weeklyScheduleEnabled: enabled,
      weeklySchedule: enabled ? normalizeWeeklySchedule(draft.weeklySchedule) : undefined,
    });
  };

  const patchWorkDay = (day: WorkDayKey, patch: NonNullable<WeeklyWorkSchedule[WorkDayKey]>) => {
    if (!draft) return;
    const schedule = normalizeWeeklySchedule(draft.weeklySchedule);
    schedule[day] = { ...(schedule[day] ?? { useDefault: true }), ...patch };
    setDraft({ ...draft, weeklySchedule: schedule });
  };

  const setDayTime = (day: WorkDayKey, start: string, end: string) => {
    patchWorkDay(day, { useDefault: false, off: false, start, end });
  };

  const applyDefaultToAllDays = () => {
    if (!draft) return;
    setDraft({ ...draft, weeklySchedule: defaultWeeklySchedule() });
  };

  const setWeekendOff = () => {
    if (!draft) return;
    const schedule = normalizeWeeklySchedule(draft.weeklySchedule);
    schedule.sat = { useDefault: false, off: true };
    schedule.sun = { useDefault: false, off: true };
    setDraft({ ...draft, weeklySchedule: schedule });
  };

  return (
    <>
      <Card
        title="신규 직원 추가"
        icon="＋"
        action={<button className="btn btn-primary btn-sm" onClick={() => void copySignupLink()}>회원가입 링크 복사</button>}
      >
        <p className="muted small" style={{ margin: 0 }}>
          신규 직원은 회원가입 링크로 계정을 만들면 직원번호가 자동 발급됩니다. 이 화면에서는 기존 직원 정보 수정, 권한 변경, 선택 삭제를 관리합니다.
        </p>
      </Card>

      {candidateName && (
        <Card
          title="직접 입력 이름 정식 등록"
          icon="🌱"
          action={
            <button className="btn btn-primary btn-sm" onClick={() => void copySignupLink(candidateSignupUrl)}>
              이름 포함 링크 복사
            </button>
          }
        >
          <div className="candidate-register">
            <div>
              <span className="candidate-name">{candidateName}</span>
              <p className="muted small">
                이 이름은 근무표에서 직접 입력된 이름입니다. 링크를 보내면 회원가입 화면 이름 칸에 미리 채워집니다.
              </p>
            </div>
            <span className="candidate-url">{candidateSignupUrl}</span>
          </div>
        </Card>
      )}

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <StatCard label="전체 직원" value={employees.length} unit="명" icon="👥" />
        <StatCard label="계정 연결" value={linked.length} unit="명" icon="🔐" tone="blue" />
        <StatCard label="관리자" value={adminProfiles.length} unit="명" icon="🛡️" tone="green" />
        <StatCard label="매니저" value={managerCount} unit="명" icon="🛠️" tone="amber" />
      </div>

      {isAdmin && unlinkedAdminProfiles.length > 0 && (
        <Card title="관리자 계정 근무표 추가" icon="🛡️">
          <div className="stack" style={{ gap: 8 }}>
            {unlinkedAdminProfiles.map((admin) => (
              <div className="list-row" key={admin.uid} style={{ flexWrap: "wrap" }}>
                <span className="avatar">{(admin.name || "관")[0]}</span>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <span className="bold small">{admin.name}</span>
                    <Badge tone="green">관리자</Badge>
                  </div>
                  <div className="muted small">
                    아직 직원 문서가 없어 근무표 직원 선택에 나오지 않습니다.
                  </div>
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={linkingUid === admin.uid}
                  onClick={() => void addAdminToEmployees(admin.uid)}
                >
                  {linkingUid === admin.uid ? "추가 중..." : "근무표에 추가"}
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {draft && editing && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEdit();
          }}
        >
          <section className="modal-panel employee-edit-modal" role="dialog" aria-modal="true" aria-labelledby="employee-edit-title">
            <div className="modal-head">
              <div>
                <h2 id="employee-edit-title">{editing.name} 정보 수정</h2>
                <p>직원 기본 정보와 급여 기준을 수정합니다.</p>
              </div>
              <button className="icon-btn" type="button" onClick={closeEdit} aria-label="닫기">×</button>
            </div>

            <div className="modal-body">
              <div className="modal-section-title">기본 정보</div>
              <div className="grid grid-3 employee-edit-grid">
                <div>
                  <label className="field-label">이름</label>
                  <input className="input" value={draft.name} onChange={(e) => updateDraft("name", e.target.value)} />
                </div>
                <div>
                  <label className="field-label">직무</label>
                  <select className="select" value={draft.role} onChange={(e) => updateDraft("role", e.target.value)}>
                    {WORK_ROLE_OPTIONS.map((workRole) => <option key={workRole} value={workRole}>{workRole}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">직책 표시</label>
                  <input className="input" value={draft.roleLabel ?? ""} onChange={(e) => updateDraft("roleLabel", e.target.value || undefined)} placeholder="사장, 점장, 팀장 등" />
                </div>
              </div>

              <div className="modal-section-title">급여 정보</div>
              <div className="grid grid-3 employee-edit-grid">
                <div>
                  <label className="field-label">고용형태</label>
                  <select
                    className="select"
                    value={draft.employmentType}
                    onChange={(e) => {
                      const employmentType = e.target.value as EmploymentType;
                      updateDraftPatch({
                        employmentType,
                        weeklyScheduleEnabled: employmentType === "fullTime" ? draft.weeklyScheduleEnabled : false,
                        weeklySchedule: employmentType === "fullTime" ? draft.weeklySchedule : undefined,
                      });
                    }}
                  >
                    <option value="fullTime">정직원</option>
                    <option value="partTime">아르바이트</option>
                  </select>
                </div>
                <div>
                  <label className="field-label">급여방식</label>
                  <select className="select" value={draft.salaryType} onChange={(e) => updateDraft("salaryType", e.target.value as SalaryType)}>
                    <option value="monthly">월급</option>
                    <option value="hourly">시급</option>
                    <option value="perSlot">건별수당</option>
                  </select>
                </div>
                <div>
                  <label className="field-label">금액</label>
                  {draft.salaryType === "monthly" ? (
                    <input className="input" inputMode="numeric" value={draft.monthlySalary ?? ""} onChange={(e) => updateDraft("monthlySalary", toNumber(e.target.value))} placeholder="월급" />
                  ) : draft.salaryType === "perSlot" ? (
                    <input className="input" inputMode="numeric" value={draft.slotRate ?? ""} onChange={(e) => updateDraft("slotRate", toNumber(e.target.value))} placeholder="슬롯당 금액" />
                  ) : (
                    <input className="input" inputMode="numeric" value={draft.hourly ?? ""} onChange={(e) => updateDraft("hourly", toNumber(e.target.value))} placeholder="시급" />
                  )}
                </div>
              </div>

              <label className="insurance-toggle-card employee-edit-insurance">
                <input
                  type="checkbox"
                  checked={draft.socialInsurance === true}
                  onChange={(e) => updateDraft("socialInsurance", e.target.checked)}
                />
                <span className={`checkbox ${draft.socialInsurance ? "checked" : ""}`}>
                  {draft.socialInsurance ? "✓" : ""}
                </span>
                <span>
                  <strong>4대보험 적용 대상자</strong>
                  <small>체크한 직원만 급여관리에서 근로자 부담분을 자동 차감합니다.</small>
                </span>
              </label>

              {draft.employmentType === "fullTime" && (
                <div className="worktime-editor">
                  <div className="grid grid-2 employee-edit-grid">
                    <div>
                      <label className="field-label">기본 출근시간</label>
                      <input className="input" value={draft.standardStart ?? ""} onChange={(e) => updateDraft("standardStart", e.target.value || undefined)} placeholder="10:00" />
                    </div>
                    <div>
                      <label className="field-label">기본 퇴근시간</label>
                      <input className="input" value={draft.standardEnd ?? ""} onChange={(e) => updateDraft("standardEnd", e.target.value || undefined)} placeholder="22:00" />
                    </div>
                  </div>

                  <div className="preset-row">
                    {WORK_TIME_PRESETS.map((preset) => (
                      <button
                        className="btn btn-soft btn-sm"
                        type="button"
                        key={preset.label}
                        onClick={() => updateDraftPatch({ standardStart: preset.start, standardEnd: preset.end })}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  <label className="insurance-toggle-card employee-edit-insurance">
                    <input
                      type="checkbox"
                      checked={draft.weeklyScheduleEnabled === true}
                      onChange={(e) => toggleWeeklySchedule(e.target.checked)}
                    />
                    <span className={`checkbox ${draft.weeklyScheduleEnabled ? "checked" : ""}`}>
                      {draft.weeklyScheduleEnabled ? "✓" : ""}
                    </span>
                    <span>
                      <strong>요일별로 다른 시간이 있어요</strong>
                      <small>대부분은 기본 시간을 그대로 쓰고, 다른 요일만 휴무나 별도 시간으로 바꿉니다.</small>
                    </span>
                  </label>

                  {draft.weeklyScheduleEnabled && (
                    <div className="weekly-work-editor">
                      <div className="weekly-work-actions">
                        <button className="btn btn-outline btn-sm" type="button" onClick={applyDefaultToAllDays}>전체 기본값</button>
                        <button className="btn btn-outline btn-sm" type="button" onClick={setWeekendOff}>주말 휴무</button>
                      </div>
                      <div className="weekly-work-grid">
                        {WORK_DAYS.map((day) => {
                          const value = normalizeWeeklySchedule(draft.weeklySchedule)[day.key] ?? { useDefault: true };
                          const usesDefault = value.useDefault !== false && value.off !== true;
                          return (
                            <div className={`weekly-work-day ${value.off ? "off" : ""}`} key={day.key}>
                              <div className="weekly-work-day-head">
                                <strong>{day.short}</strong>
                                <span>{usesDefault ? "기본" : value.off ? "휴무" : "예외"}</span>
                              </div>
                              <div className="segmented compact">
                                <button
                                  type="button"
                                  className={usesDefault ? "on" : ""}
                                  onClick={() => patchWorkDay(day.key, { useDefault: true, off: false, start: undefined, end: undefined })}
                                >
                                  기본
                                </button>
                                <button
                                  type="button"
                                  className={value.off ? "on" : ""}
                                  onClick={() => patchWorkDay(day.key, { useDefault: false, off: true })}
                                >
                                  휴무
                                </button>
                              </div>
                              <div className="grid grid-2 employee-edit-grid">
                                <input
                                  className="input"
                                  value={value.start ?? ""}
                                  disabled={usesDefault || value.off}
                                  onChange={(e) => patchWorkDay(day.key, { useDefault: false, off: false, start: e.target.value })}
                                  placeholder={draft.standardStart ?? "10:00"}
                                />
                                <input
                                  className="input"
                                  value={value.end ?? ""}
                                  disabled={usesDefault || value.off}
                                  onChange={(e) => patchWorkDay(day.key, { useDefault: false, off: false, end: e.target.value })}
                                  placeholder={draft.standardEnd ?? "22:00"}
                                />
                              </div>
                              <div className="weekly-work-presets">
                                {WORK_TIME_PRESETS.map((preset) => (
                                  <button className="chip-button" type="button" key={preset.label} onClick={() => setDayTime(day.key, preset.start, preset.end)}>
                                    {preset.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="modal-section-title">연락처와 계좌</div>
              <div className="grid grid-3 employee-edit-grid">
                <div>
                  <label className="field-label">연락처</label>
                  <input className="input" value={draft.phone ?? ""} onChange={(e) => updateDraft("phone", e.target.value || undefined)} />
                </div>
                <div>
                  <label className="field-label">주소</label>
                  <input className="input" value={draft.address ?? ""} onChange={(e) => updateDraft("address", e.target.value || undefined)} />
                </div>
                <div>
                  <label className="field-label">주민번호</label>
                  <input className="input" value={draft.residentRegistrationNumber ?? ""} onChange={(e) => updateDraft("residentRegistrationNumber", e.target.value || undefined)} placeholder="000000-0000000" />
                </div>
              </div>

              <div className="grid grid-2 employee-edit-grid">
                <div>
                  <label className="field-label">은행</label>
                  <input className="input" value={draft.bank ?? ""} onChange={(e) => updateDraft("bank", e.target.value || undefined)} />
                </div>
                <div>
                  <label className="field-label">계좌번호</label>
                  <input className="input" value={draft.account ?? ""} onChange={(e) => updateDraft("account", e.target.value || undefined)} />
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-outline" type="button" onClick={closeEdit}>취소</button>
              <button className="btn btn-primary" type="button" onClick={saveEmployee}>저장</button>
            </div>
          </section>
        </div>
      )}

      {contractEmployee && (
        <Card title="근로계약서 작성" icon="📝">
          <EmploymentContractBuilder
            key={contractEmployee.id}
            employee={contractEmployee}
            onClose={() => setContractEmployee(null)}
            showToast={showToast}
          />
        </Card>
      )}

      <Card title="직원 관리" icon="👥">
        <div className="bulk-bar">
          <label className="check-row">
            <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} />
            <span>전체선택</span>
          </label>
          <span className="muted small">선택 {selectedIds.length}명</span>
          {isAdmin && <button className="btn btn-danger btn-sm" onClick={deleteSelected} disabled={selectedIds.length === 0}>선택삭제</button>}
          <button
            className="btn btn-outline btn-sm"
            disabled={selectedIds.length !== 1}
            onClick={() => {
              const employee = employees.find((item) => item.id === selectedIds[0]);
              if (employee) openEdit(employee);
            }}
          >
            선택수정
          </button>
        </div>

        {loading ? (
          <div className="muted small" style={{ textAlign: "center", padding: "20px 0" }}>
            불러오는 중...
          </div>
        ) : (
          <div className="stack" style={{ gap: 6 }}>
            {employees.map((emp) => {
              const uid = emp.uid;
              const userProfile = uid ? profilesByUid.get(uid) : undefined;
              const appRole = userProfile?.role ?? "staff";

              return (
                <div className="list-row" key={emp.id} style={{ flexWrap: "wrap" }}>
                  <label className="check-row" style={{ flex: "0 0 auto" }}>
                    <input type="checkbox" checked={selectedIds.includes(emp.id)} onChange={() => toggleSelected(emp.id)} />
                  </label>
                  <span className="avatar">{emp.name[0]}</span>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div className="bold small">
                      {emp.name}
                      <span className="muted small" style={{ marginLeft: 6 }}>#{emp.id}</span>
                    </div>
                    <div className="muted small">
                      {emp.role} · {employmentLabel(emp)} · {salaryTypeLabel(emp)}
                      {emp.phone && ` · ${emp.phone}`}
                      {emp.address && ` · ${emp.address}`}
                      {emp.socialInsurance && " · 4대보험"}
                      {workTimeSummary(emp) && ` · ${workTimeSummary(emp)}`}
                    </div>
                  </div>

                  <div className="row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button className="btn btn-outline btn-sm" onClick={() => openEdit(emp)}>수정</button>
                    <button className="btn btn-soft btn-sm" onClick={() => openContract(emp)}>근로계약서</button>
                    {uid ? (
                      <>
                        <Badge tone={roleTone(appRole)}>{roleLabel(appRole)}</Badge>
                        {!isAdmin ? (
                          <span className="muted small">권한 변경은 관리자만 가능</span>
                        ) : appRole === "admin" ? (
                          <span className="muted small">관리자 권한은 콘솔에서 관리</span>
                        ) : (
                          <div className="segmented" aria-label={`${emp.name} 권한 변경`}>
                            {ROLE_OPTIONS.map((option) => (
                              <button
                                key={option}
                                className={appRole === option ? "on" : ""}
                                disabled={savingUid === uid || appRole === option}
                                onClick={() => void changeRole(uid, option)}
                              >
                                {roleLabel(option)}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <Badge tone="gray">계정 미연결</Badge>
                    )}
                  </div>
                </div>
              );
            })}
            {employees.length === 0 && (
              <div className="muted small" style={{ textAlign: "center", padding: "20px 0" }}>
                등록된 직원이 없습니다.
              </div>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
