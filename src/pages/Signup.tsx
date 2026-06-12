import { useState, FormEvent } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../store";
import { authErrorMessage } from "../services/auth";

export default function Signup() {
  const { signup } = useStore();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [empIdInput, setEmpIdInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();

    if (!name.trim()) { setErr("이름을 입력해주세요."); return; }
    if (!email.trim()) { setErr("이메일을 입력해주세요."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErr("이메일 형식이 올바르지 않습니다."); return;
    }
    if (password.length < 6) { setErr("비밀번호는 6자 이상이어야 합니다."); return; }
    if (password !== password2) { setErr("비밀번호가 서로 일치하지 않습니다."); return; }
    if (!empIdInput.trim()) { setErr("직원번호를 입력해주세요."); return; }
    const employeeId = Number(empIdInput.trim());
    if (!Number.isInteger(employeeId) || employeeId <= 0) {
      setErr("직원번호는 1 이상의 숫자로 입력해주세요. (예: 1, 2, 3)"); return;
    }

    setBusy(true);
    setErr(null);
    try {
      await signup(name.trim(), email.trim(), password, employeeId);
      // 성공 시 authUser가 설정되며 App이 자동으로 홈으로 이동시킴
    } catch (ex) {
      setErr(authErrorMessage(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="login-brand">
          <div className="brand-logo" style={{ width: 52, height: 52, fontSize: 26 }}>🌿</div>
          <h1 style={{ fontSize: 22, marginTop: 12 }}>하늘땅 매장관리</h1>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            직원 회원가입
          </p>
        </div>

        <label className="field-label">이름</label>
        <input
          className="input"
          autoComplete="name"
          placeholder="홍길동"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <label className="field-label" style={{ marginTop: 14 }}>이메일</label>
        <input
          className="input"
          type="email"
          autoComplete="username"
          placeholder="name@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label className="field-label" style={{ marginTop: 14 }}>비밀번호</label>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          placeholder="6자 이상"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <label className="field-label" style={{ marginTop: 14 }}>비밀번호 확인</label>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          placeholder="비밀번호 다시 입력"
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
        />

        <label className="field-label" style={{ marginTop: 14 }}>직원번호</label>
        <input
          className="input"
          inputMode="numeric"
          placeholder="예: 1"
          value={empIdInput}
          onChange={(e) => setEmpIdInput(e.target.value)}
        />
        <p className="muted small" style={{ margin: "6px 0 0" }}>
          본인의 직원번호를 모르면 매장 관리자에게 확인해주세요.
          근무표·근무기록이 이 번호로 연결됩니다.
        </p>

        {err && (
          <div className="alert-item danger" style={{ marginTop: 14 }}>
            <span>⚠️</span>
            <div>{err}</div>
          </div>
        )}

        <button
          className="btn btn-primary btn-lg btn-block"
          style={{ marginTop: 18 }}
          disabled={busy}
          type="submit"
        >
          {busy ? "가입 중..." : "회원가입"}
        </button>

        <p className="muted small" style={{ margin: "16px 0 0", textAlign: "center" }}>
          이미 계정이 있으신가요?{" "}
          <Link to="/" className="auth-link">로그인</Link>
        </p>
      </form>
    </div>
  );
}
