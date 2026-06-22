import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useStore } from "../store";
import { Card, Badge, StatCard } from "../components/ui";
import { salaryTypeLabel, employmentLabel } from "../lib/payroll";
import type { Role } from "../data/types";

const ROLE_OPTIONS: Role[] = ["staff", "manager"];

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

export default function EmployeeList() {
  const { employees, loading, userProfiles, updateUserRole, showToast } = useStore();
  const [savingUid, setSavingUid] = useState<string | null>(null);
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

  return (
    <>
      <Card
        title="신규 직원 추가"
        icon="＋"
        action={<button className="btn btn-primary btn-sm" onClick={() => void copySignupLink()}>회원가입 링크 복사</button>}
      >
        <p className="muted small" style={{ margin: 0 }}>
          현재 직원 추가는 직원이 회원가입하면 자동으로 처리됩니다. 링크를 직원에게 보내면
          가입 시 직원번호가 발급되고, 직원 문서와 앱 계정이 같이 생성됩니다.
        </p>
      </Card>

      {candidateName && (
        <Card
          title="직접 입력 이름 정식 등록"
          icon="🏷️"
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

      <Card title="권한 설정" icon="🔐">
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
                  <span className="avatar">{emp.name[0]}</span>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div className="bold small">
                      {emp.name}
                      <span className="muted small" style={{ marginLeft: 6 }}>#{emp.id}</span>
                    </div>
                    <div className="muted small">
                      {emp.role} · {employmentLabel(emp)} · {salaryTypeLabel(emp)}
                      {emp.phone && ` · ${emp.phone}`}
                    </div>
                  </div>

                  {uid ? (
                    <div className="row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
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
                    </div>
                  ) : (
                    <Badge tone="gray">계정 미연결</Badge>
                  )}
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
