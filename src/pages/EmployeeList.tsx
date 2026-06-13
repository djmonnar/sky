import { useStore } from "../store";
import { Card, Badge, StatCard } from "../components/ui";
import { salaryTypeLabel, employmentLabel } from "../lib/payroll";

export default function EmployeeList() {
  const { employees, loading } = useStore();

  const linked = employees.filter((e) => e.uid);

  return (
    <>
      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <StatCard label="전체 직원" value={employees.length} unit="명" icon="👥" />
        <StatCard label="앱 계정 연결" value={linked.length} unit="명" icon="📱" tone="blue" />
        <StatCard label="앱 미가입" value={employees.length - linked.length} unit="명" icon="📋" />
      </div>

      {linked.length > 0 && (
        <Card title="앱 가입 직원" icon="📱">
          <div className="stack" style={{ gap: 6 }}>
            {linked.map((emp) => (
              <div className="list-row" key={emp.id}>
                <span className="avatar">{emp.name[0]}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="bold small">
                    {emp.name}
                    <span className="muted small" style={{ marginLeft: 6 }}>#{emp.id}</span>
                  </div>
                  <div className="muted small">
                    {emp.role} · {employmentLabel(emp)} · {salaryTypeLabel(emp)}
                    {emp.phone && ` · ${emp.phone}`}
                  </div>
                </div>
                <Badge tone="green">가입 완료</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div style={{ marginTop: 12 }}>
        <Card title="전체 직원 목록" icon="👥">
          {loading ? (
            <div className="muted small" style={{ textAlign: "center", padding: "20px 0" }}>불러오는 중...</div>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {employees.map((emp) => (
                <div className="list-row" key={emp.id}>
                  <span className="avatar">{emp.name[0]}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="bold small">
                      {emp.name}
                      <span className="muted small" style={{ marginLeft: 6 }}>#{emp.id}</span>
                    </div>
                    <div className="muted small">
                      {emp.role} · {employmentLabel(emp)} · {salaryTypeLabel(emp)}
                    </div>
                  </div>
                  {emp.uid
                    ? <Badge tone="green">계정 연결</Badge>
                    : <Badge tone="gray">앱 미가입</Badge>
                  }
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
