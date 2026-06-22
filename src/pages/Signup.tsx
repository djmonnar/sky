import { useState, FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useStore } from "../store";
import { authErrorMessage } from "../services/auth";

const BANKS = [
  "국민", "신한", "우리", "하나", "농협", "기업", "SC제일",
  "부산", "경남", "카카오뱅크", "토스뱅크", "케이뱅크", "새마을금고", "우체국", "기타",
];

export default function Signup() {
  const { signup } = useStore();
  const [searchParams] = useSearchParams();
  const [name, setName] = useState(() => searchParams.get("name")?.trim() ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [phone, setPhone] = useState("");
  const [bank, setBank] = useState("");
  const [account, setAccount] = useState("");
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
    if (!phone.trim()) { setErr("연락처를 입력해주세요."); return; }
    if (!bank) { setErr("은행을 선택해주세요."); return; }
    if (!account.trim()) { setErr("계좌번호를 입력해주세요."); return; }
    if (!/^[0-9-]{6,}$/.test(account.trim())) {
      setErr("계좌번호는 숫자와 - 만 입력해주세요."); return;
    }

    setBusy(true);
    setErr(null);
    try {
      await signup({
        name: name.trim(), email: email.trim(), password,
        phone: phone.trim(), bank, account: account.trim(),
      });
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

        <label className="field-label" style={{ marginTop: 14 }}>연락처</label>
        <input
          className="input"
          type="tel"
          autoComplete="tel"
          inputMode="numeric"
          placeholder="010-0000-0000"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />

        <label className="field-label" style={{ marginTop: 14 }}>급여 입금 계좌</label>
        <div className="row" style={{ alignItems: "stretch" }}>
          <select
            className="select"
            style={{ flex: "0 0 38%" }}
            value={bank}
            onChange={(e) => setBank(e.target.value)}
          >
            <option value="">은행</option>
            {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <input
            className="input"
            style={{ flex: 1 }}
            inputMode="numeric"
            placeholder="계좌번호 (- 포함)"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
        </div>
        <p className="muted small" style={{ margin: "6px 0 0" }}>
          급여 입금에 사용됩니다. 직원번호는 가입 시 자동으로 부여됩니다.
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
