import { useMemo, useState } from "react";
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

  return (
    <>
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
