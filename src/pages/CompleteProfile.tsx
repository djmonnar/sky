import { useState, FormEvent } from "react";
import { useStore } from "../store";
import { authErrorMessage } from "../services/auth";

const BANKS = [
  "국민", "신한", "우리", "하나", "농협", "기업", "SC제일",
  "부산", "경남", "카카오뱅크", "토스뱅크", "케이뱅크", "새마을금고", "우체국", "기타",
];

/**
 * 로그인은 됐지만 직원 프로필이 없는 경우(가입 중 네트워크 문제로 트랜잭션이
 * 끊긴 경우 등) 프로필을 완성하는 화면. createStaffProfile을 다시 실행한다.
 */
export default function CompleteProfile() {
  const { authUser, completeProfile, logout } = useStore();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [residentRegistrationNumber, setResidentRegistrationNumber] = useState("");
  const [bank, setBank] = useState("");
  const [account, setAccount] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr("이름을 입력해주세요."); return; }
    if (!phone.trim()) { setErr("연락처를 입력해주세요."); return; }
    if (!address.trim()) { setErr("주소를 입력해주세요."); return; }
    if (!/^\d{6}-?\d{7}$/.test(residentRegistrationNumber.trim())) {
      setErr("주민번호는 000000-0000000 형식으로 입력해주세요."); return;
    }
    if (!bank) { setErr("은행을 선택해주세요."); return; }
    if (!account.trim()) { setErr("계좌번호를 입력해주세요."); return; }
    if (!/^[0-9-]{6,}$/.test(account.trim())) {
      setErr("계좌번호는 숫자와 - 만 입력해주세요."); return;
    }
    setBusy(true);
    setErr(null);
    try {
      await completeProfile({
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim(),
        residentRegistrationNumber: residentRegistrationNumber.trim(),
        bank,
        account: account.trim(),
      });
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
          <h1 style={{ fontSize: 21, marginTop: 12 }}>프로필 완성하기</h1>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            가입이 마무리되지 않았어요. 정보를 한 번만 더 확인해주세요.
          </p>
        </div>

        <div className="alert-item info" style={{ marginBottom: 4 }}>
          <span>👤</span>
          <div>{authUser?.email ?? "로그인된 계정"}</div>
        </div>

        <label className="field-label" style={{ marginTop: 14 }}>이름</label>
        <input className="input" autoComplete="name" placeholder="홍길동"
          value={name} onChange={(e) => setName(e.target.value)} />

        <label className="field-label" style={{ marginTop: 14 }}>연락처</label>
        <input className="input" type="tel" inputMode="numeric" placeholder="010-0000-0000"
          value={phone} onChange={(e) => setPhone(e.target.value)} />

        <label className="field-label" style={{ marginTop: 14 }}>주소</label>
        <input className="input" autoComplete="street-address" placeholder="주소"
          value={address} onChange={(e) => setAddress(e.target.value)} />

        <label className="field-label" style={{ marginTop: 14 }}>주민번호</label>
        <input className="input" inputMode="numeric" autoComplete="off" placeholder="000000-0000000"
          value={residentRegistrationNumber} onChange={(e) => setResidentRegistrationNumber(e.target.value)} />

        <label className="field-label" style={{ marginTop: 14 }}>급여 입금 계좌</label>
        <div className="row" style={{ alignItems: "stretch" }}>
          <select className="select" style={{ flex: "0 0 38%" }} value={bank} onChange={(e) => setBank(e.target.value)}>
            <option value="">은행</option>
            {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <input className="input" style={{ flex: 1 }} inputMode="numeric" placeholder="계좌번호 (- 포함)"
            value={account} onChange={(e) => setAccount(e.target.value)} />
        </div>
        <p className="muted small" style={{ margin: "6px 0 0" }}>
          직원번호는 자동으로 부여됩니다.
        </p>

        {err && (
          <div className="alert-item danger" style={{ marginTop: 14 }}>
            <span>⚠️</span><div>{err}</div>
          </div>
        )}

        <button className="btn btn-primary btn-lg btn-block" style={{ marginTop: 18 }} disabled={busy} type="submit">
          {busy ? "처리 중..." : "완료하기"}
        </button>

        <p className="muted small" style={{ margin: "16px 0 0", textAlign: "center" }}>
          다른 계정인가요?{" "}
          <button type="button" className="auth-link" style={{ background: "none", border: "none", padding: 0 }}
            onClick={() => void logout()}>로그아웃</button>
        </p>
      </form>
    </div>
  );
}
