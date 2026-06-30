import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useStore } from "../store";
import { Card, Badge, StatCard } from "../components/ui";
import EmploymentContractBuilder from "../components/EmploymentContractBuilder";
import { salaryTypeLabel, employmentLabel } from "../lib/payroll";
import type { Employee, EmploymentType, Role, SalaryType } from "../data/types";

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
    upsertEmployee, deleteEmployee, showToast,
  } = useStore();
  const [savingUid, setSavingUid] = useState<string | null>(null);
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
  const managerCount = userProfiles.filter((p) => p.role === "manager").length;
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
    setDraft({ ...employee });
    setContractEmployee(null);
  };

  const openContract = (employee: Employee) => {
    setContractEmployee(employee);
    setEditing(null);
    setDraft(null);
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
    };
    upsertEmployee(normalized);
    setEditing(null);
    setDraft(null);
    showToast(`${normalized.name} 정보를 저장했습니다`);
  };

  const deleteSelected = () => {
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
      setEditing(null);
      setDraft(null);
    }
    showToast("선택한 직원을 삭제했습니다");
  };

  const updateDraft = <K extends keyof Employee>(key: K, value: Employee[K]) => {
    if (!draft) return;
    setDraft({ ...draft, [key]: value });
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

      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <StatCard label="전체 직원" value={employees.length} unit="명" icon="👥" />
        <StatCard label="계정 연결" value={linked.length} unit="명" icon="🔐" tone="blue" />
        <StatCard label="매니저" value={managerCount} unit="명" icon="🛠️" tone="amber" />
      </div>

      {draft && (
        <Card title={`${editing?.name ?? "직원"} 정보 수정`} icon="✎">
          <div className="grid grid-3" style={{ gap: 12 }}>
            <div>
              <label className="field-label">이름</label>
              <input className="input" value={draft.name} onChange={(e) => updateDraft("name", e.target.value)} />
            </div>
            <div>
              <label className="field-label">직무</label>
              <select className="select" value={draft.role} onChange={(e) => updateDraft("role", e.target.value)}>
                {WORK_ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">직책 표시</label>
              <input className="input" value={draft.roleLabel ?? ""} onChange={(e) => updateDraft("roleLabel", e.target.value || undefined)} placeholder="사장, 점장, 팀장 등" />
            </div>
          </div>

          <div className="grid grid-3" style={{ gap: 12, marginTop: 14 }}>
            <div>
              <label className="field-label">고용형태</label>
              <select className="select" value={draft.employmentType} onChange={(e) => updateDraft("employmentType", e.target.value as EmploymentType)}>
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

          <div className="grid grid-3" style={{ gap: 12, marginTop: 14 }}>
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

          <div className="grid grid-2" style={{ gap: 12, marginTop: 14 }}>
            <div>
              <label className="field-label">은행</label>
              <input className="input" value={draft.bank ?? ""} onChange={(e) => updateDraft("bank", e.target.value || undefined)} />
            </div>
            <div>
              <label className="field-label">계좌번호</label>
              <input className="input" value={draft.account ?? ""} onChange={(e) => updateDraft("account", e.target.value || undefined)} />
            </div>
          </div>

          <label className="insurance-toggle-card" style={{ marginTop: 14 }}>
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
            <div className="grid grid-2" style={{ gap: 12, marginTop: 14 }}>
              <div>
                <label className="field-label">고정 출근</label>
                <input className="input" value={draft.standardStart ?? ""} onChange={(e) => updateDraft("standardStart", e.target.value || undefined)} placeholder="10:00" />
              </div>
              <div>
                <label className="field-label">고정 퇴근</label>
                <input className="input" value={draft.standardEnd ?? ""} onChange={(e) => updateDraft("standardEnd", e.target.value || undefined)} placeholder="22:00" />
              </div>
            </div>
          )}

          <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
            <button className="btn btn-outline" onClick={() => { setEditing(null); setDraft(null); }}>취소</button>
            <button className="btn btn-primary" onClick={saveEmployee}>저장</button>
          </div>
        </Card>
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
          <button className="btn btn-danger btn-sm" onClick={deleteSelected} disabled={selectedIds.length === 0}>선택삭제</button>
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
                    </div>
                  </div>

                  <div className="row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button className="btn btn-outline btn-sm" onClick={() => openEdit(emp)}>수정</button>
                    <button className="btn btn-soft btn-sm" onClick={() => openContract(emp)}>근로계약서</button>
                    {uid ? (
                      <>
                        <Badge tone={roleTone(appRole)}>{roleLabel(appRole)}</Badge>
                        {appRole === "admin" ? (
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
