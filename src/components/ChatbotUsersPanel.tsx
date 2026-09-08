import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { Badge, Card } from "./ui";
import {
  chatbotUserDocId,
  fsDeleteChatbotUser,
  fsUpsertChatbotUser,
  subscribeChatbotUsers,
} from "../services/firestore";
import type { ChatbotUser, Role } from "../data/types";

/* ============================================================
   카카오 챗봇 사용자 관리 (관리자 모드 전용)

   카카오 요청에는 Firebase 로그인이 없어서, 카카오가 사용자마다 붙여 주는
   식별키(botUserKey)를 stores/{id}/chatbotUsers/{키} 문서로 등록해야 챗봇을
   쓸 수 있다. 예전에는 Firebase 콘솔에서 직접 문서를 만들었는데, 그 일을
   이 화면에서 한다. Firestore 규칙이 admin 에게만 이 컬렉션을 열어 주므로
   매니저/실무자가 주소로 들어와도 읽기부터 거부된다.
   ============================================================ */

const ROLE_OPTIONS: { value: Role; label: string; desc: string }[] = [
  { value: "staff", label: "실무자", desc: "예약 조회·등록, 본인 근무표, 전달사항" },
  { value: "manager", label: "매니저", desc: "실무자 기능 + 근무표·직원 목록·공지·재고 사진" },
  { value: "admin", label: "관리자", desc: "전체 기능 (직원 등록, 급여, 거래처, 레시피 포함)" },
];

function roleLabel(role: Role): string {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
}

function roleTone(role: Role): string {
  if (role === "admin") return "green";
  if (role === "manager") return "blue";
  return "gray";
}

function maskKey(key: string): string {
  if (key.length <= 10) return key;
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

interface Draft {
  key: string;
  name: string;
  role: Role;
  employeeId: string;
  memo: string;
}

const EMPTY_DRAFT: Draft = { key: "", name: "", role: "staff", employeeId: "", memo: "" };

export default function ChatbotUsersPanel() {
  const { mode, role, employees, showToast } = useStore();
  const isAdmin = role === "admin";
  const live = mode === "live";

  const [users, setUsers] = useState<ChatbotUser[]>([]);
  const [loading, setLoading] = useState(live && isAdmin);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!live || !isAdmin) return;
    setLoading(true);
    const unsub = subscribeChatbotUsers(
      (items) => {
        setUsers(items);
        setError(null);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      }
    );
    return unsub;
  }, [live, isAdmin]);

  const activeEmployees = useMemo(
    () => [...employees].sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [employees]
  );
  const employeeName = (id?: number) => (id ? activeEmployees.find((e) => e.id === id)?.name ?? employees.find((e) => e.id === id)?.name ?? `#${id}` : null);

  const normalizedKey = chatbotUserDocId(draft.key);
  const duplicate = !editingId && users.some((user) => user.id === normalizedKey);

  const updateDraft = <K extends keyof Draft>(field: K, value: Draft[K]) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  };

  const pickEmployee = (value: string) => {
    const id = Number(value);
    const employee = activeEmployees.find((e) => e.id === id);
    setDraft((prev) => ({
      ...prev,
      employeeId: value,
      // 이름이 비어 있으면 직원 이름을 채워 준다. 이미 적은 이름은 건드리지 않는다.
      name: prev.name.trim() ? prev.name : employee?.name ?? prev.name,
    }));
  };

  const startEdit = (user: ChatbotUser) => {
    setEditingId(user.id);
    setDraft({
      key: user.id,
      name: user.name,
      role: user.role,
      employeeId: user.employeeId ? String(user.employeeId) : "",
      memo: user.memo ?? "",
    });
  };

  const resetDraft = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  };

  const save = async () => {
    if (!live) {
      showToast("데모 모드에서는 챗봇 사용자를 저장할 수 없습니다.");
      return;
    }
    if (!normalizedKey) {
      showToast("카카오 식별키를 입력해주세요.");
      return;
    }
    if (!draft.name.trim()) {
      showToast("이름을 입력해주세요.");
      return;
    }
    if (duplicate) {
      showToast("이미 등록된 식별키입니다. 아래 목록에서 수정해주세요.");
      return;
    }
    setSaving(true);
    try {
      await fsUpsertChatbotUser({
        id: normalizedKey,
        name: draft.name.trim(),
        role: draft.role,
        employeeId: draft.employeeId ? Number(draft.employeeId) : undefined,
        active: editingId ? users.find((user) => user.id === editingId)?.active ?? true : true,
        memo: draft.memo.trim() || undefined,
      });
      showToast(editingId ? "챗봇 사용자를 수정했습니다." : "챗봇 사용자를 등록했습니다. 카톡에서 다시 말을 걸면 바로 적용됩니다.");
      resetDraft();
    } catch (e) {
      showToast(`저장 실패: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (user: ChatbotUser) => {
    try {
      await fsUpsertChatbotUser({ ...user, active: !user.active });
      showToast(user.active ? `${user.name} 챗봇 사용을 중지했습니다.` : `${user.name} 챗봇 사용을 다시 허용했습니다.`);
    } catch (e) {
      showToast(`변경 실패: ${(e as Error).message}`);
    }
  };

  const remove = async (user: ChatbotUser) => {
    if (!window.confirm(`${user.name} 님의 챗봇 등록을 삭제할까요?\n삭제하면 카톡에서 다시 식별키를 받아 등록해야 합니다.\n잠시 막아 두려면 삭제 대신 '중지'를 쓰세요.`)) return;
    try {
      await fsDeleteChatbotUser(user.id);
      if (editingId === user.id) resetDraft();
      showToast("챗봇 등록을 삭제했습니다.");
    } catch (e) {
      showToast(`삭제 실패: ${(e as Error).message}`);
    }
  };

  if (!isAdmin) {
    return (
      <Card title="카카오 챗봇 사용자" icon="💬">
        <div className="alert-item danger"><span>!</span><div>카카오 챗봇 사용자 관리는 관리자만 할 수 있습니다.</div></div>
      </Card>
    );
  }

  const activeCount = users.filter((user) => user.active).length;

  return (
    <div className="stack">
      <Card title="카카오 챗봇 등록 방법" icon="📱">
        <ol className="muted small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>직원이 카카오톡 챗봇에 아무 말이나 보냅니다.</li>
          <li>미등록이면 챗봇이 <strong>식별키</strong>를 알려 줍니다. 그 키를 관리자에게 전달받습니다.</li>
          <li>아래에 식별키·이름·역할을 넣고 등록합니다. 직원을 연결하면 본인 근무표 조회가 됩니다.</li>
          <li>직원이 카톡에서 다시 말을 걸면 바로 권한이 적용됩니다.</li>
        </ol>
        {!live && (
          <div className="alert-item warn" style={{ marginTop: 12 }}>
            <span>!</span>
            <div>데모 모드에서는 목록이 비어 있고 저장도 되지 않습니다. 라이브 모드에서 사용하세요.</div>
          </div>
        )}
      </Card>

      <Card title={editingId ? "챗봇 사용자 수정" : "챗봇 사용자 등록"} icon={editingId ? "✏️" : "➕"}>
        <div className="grid grid-3" style={{ gap: 12 }}>
          <div>
            <label className="field-label">카카오 식별키</label>
            <input
              className="input"
              value={draft.key}
              disabled={Boolean(editingId)}
              onChange={(e) => updateDraft("key", e.target.value)}
              placeholder="챗봇이 알려 준 키를 그대로 붙여넣기"
              spellCheck={false}
              autoCapitalize="off"
            />
            {duplicate && <div className="small" style={{ color: "var(--red-tx)", marginTop: 4 }}>이미 등록된 키입니다.</div>}
          </div>
          <div>
            <label className="field-label">이름</label>
            <input className="input" value={draft.name} onChange={(e) => updateDraft("name", e.target.value)} placeholder="카톡에서 부를 이름" />
          </div>
          <div>
            <label className="field-label">역할</label>
            <select className="select" value={draft.role} onChange={(e) => updateDraft("role", e.target.value as Role)}>
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <div className="muted small" style={{ marginTop: 4 }}>
              {ROLE_OPTIONS.find((option) => option.value === draft.role)?.desc}
            </div>
          </div>
        </div>
        <div className="grid grid-3" style={{ gap: 12, marginTop: 14 }}>
          <div>
            <label className="field-label">연결할 직원 (선택)</label>
            <select className="select" value={draft.employeeId} onChange={(e) => pickEmployee(e.target.value)}>
              <option value="">연결 안 함</option>
              {activeEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.name} · {employee.roleLabel || employee.role}</option>
              ))}
            </select>
          </div>
          <div style={{ gridColumn: "span 2" }}>
            <label className="field-label">메모 (선택)</label>
            <input className="input" value={draft.memo} onChange={(e) => updateDraft("memo", e.target.value)} placeholder="예: 홀 담당, 2026-09 등록" />
          </div>
        </div>
        <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          {editingId && <button className="btn btn-outline" onClick={resetDraft} disabled={saving}>취소</button>}
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving || !live}>
            {saving ? "저장 중…" : editingId ? "수정 저장" : "챗봇 사용자 등록"}
          </button>
        </div>
      </Card>

      <Card
        title="등록된 챗봇 사용자"
        icon="👥"
        action={<span className="muted small">{activeCount}명 사용 중 / 전체 {users.length}명</span>}
      >
        {error && (
          <div className="alert-item danger" style={{ marginBottom: 12 }}>
            <span>!</span>
            <div>{error}</div>
          </div>
        )}
        {loading ? (
          <div className="empty-state">불러오는 중...</div>
        ) : users.length === 0 ? (
          <div className="empty-state">등록된 챗봇 사용자가 없습니다. 위에서 식별키를 등록해주세요.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>역할</th>
                  <th>연결 직원</th>
                  <th>식별키</th>
                  <th>상태</th>
                  <th style={{ textAlign: "right" }}>관리</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} style={{ opacity: user.active ? 1 : 0.6 }}>
                    <td>
                      <strong>{user.name || "(이름 없음)"}</strong>
                      {user.memo && <div className="muted small">{user.memo}</div>}
                    </td>
                    <td><Badge tone={roleTone(user.role)}>{roleLabel(user.role)}</Badge></td>
                    <td>{employeeName(user.employeeId) ?? <span className="muted">-</span>}</td>
                    <td title={user.id}><code style={{ fontSize: 12 }}>{maskKey(user.id)}</code></td>
                    <td>{user.active ? <Badge tone="green">사용 중</Badge> : <Badge tone="red">중지</Badge>}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn btn-outline btn-sm" onClick={() => startEdit(user)}>수정</button>{" "}
                      <button className="btn btn-outline btn-sm" onClick={() => void toggleActive(user)}>
                        {user.active ? "중지" : "허용"}
                      </button>{" "}
                      <button className="btn btn-danger btn-sm" onClick={() => void remove(user)}>삭제</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
