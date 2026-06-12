import { useState, FormEvent } from "react";
import { Link } from "react-router-dom";
import { useStore } from "../store";
import { authErrorMessage } from "../services/auth";

export default function Login() {
  const { login } = useStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setErr("이메일과 비밀번호를 입력해주세요.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await login(email, password);
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
            직원 계정으로 로그인해주세요
          </p>
        </div>

        <label className="field-label">이메일</label>
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
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

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
          {busy ? "로그인 중..." : "로그인"}
        </button>

        <p className="muted small" style={{ margin: "16px 0 0", textAlign: "center" }}>
          계정이 없으신가요?{" "}
          <Link to="/signup" className="auth-link">회원가입</Link>
        </p>
      </form>
    </div>
  );
}
