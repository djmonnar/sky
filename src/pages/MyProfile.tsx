import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useStore } from "../store";
import { Card, Badge } from "../components/ui";

const BANKS = [
  "국민", "신한", "우리", "하나", "농협", "기업", "SC제일",
  "부산", "경남", "카카오뱅크", "토스뱅크", "케이뱅크", "새마을금고", "우체국", "기타",
];

function roleLabel(role: string): string {
  if (role === "admin") return "관리자";
  if (role === "manager") return "매니저";
  return "실무자";
}

export default function MyProfile() {
  const { profile, currentEmployee, updateMyProfile, logout } = useStore();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [residentRegistrationNumber, setResidentRegistrationNumber] = useState("");
  const [bank, setBank] = useState("");
  const [account, setAccount] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(profile?.name ?? currentEmployee?.name ?? "");
    setPhone(profile?.phone ?? currentEmployee?.phone ?? "");
    setAddress(profile?.address ?? currentEmployee?.address ?? "");
    setResidentRegistrationNumber(
      profile?.residentRegistrationNumber ?? currentEmployee?.residentRegistrationNumber ?? ""
    );
    setBank(profile?.bank ?? currentEmployee?.bank ?? "");
    setAccount(profile?.account ?? currentEmployee?.account ?? "");
  }, [currentEmployee, profile]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr("이름을 입력해주세요."); return; }
    if (!phone.trim()) { setErr("연락처를 입력해주세요."); return; }
    if (!address.trim()) { setErr("주소를 입력해주세요."); return; }
    if (!/^\d{6}-?\d{7}$/.test(residentRegistrationNumber.trim())) {
      setErr("주민번호는 000000-0000000 형식으로 입력해주세요."); return;
    }
    if (!bank.trim()) { setErr("은행을 선택해주세요."); return; }
    if (!/^[0-9-]{6,}$/.test(account.trim())) {
      setErr("계좌번호는 숫자와 -만 입력해주세요."); return;
    }

    setBusy(true);
    setErr(null);
    try {
      await updateMyProfile({
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim(),
        residentRegistrationNumber: residentRegistrationNumber.trim(),
        bank,
        account: account.trim(),
      });
      navigate(-1);
    } catch (error) {
      console.error(error);
      setErr("저장에 실패했습니다. 권한 또는 네트워크 상태를 확인해주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="profile-wrap">
      <Card
        title="내 정보 수정"
        icon="👤"
        action={<Badge tone="green">{roleLabel(profile?.role ?? "staff")}</Badge>}
      >
        <form onSubmit={submit}>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div>
              <label className="field-label">이름</label>
              <input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="field-label">직원번호</label>
              <input className="input" value={profile?.employeeId ?? currentEmployee?.id ?? "-"} disabled />
            </div>
          </div>

          <div className="grid grid-2" style={{ gap: 12, marginTop: 14 }}>
            <div>
              <label className="field-label">연락처</label>
              <input
                className="input"
                type="tel"
                autoComplete="tel"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="010-0000-0000"
              />
            </div>
            <div>
              <label className="field-label">주민번호</label>
              <input
                className="input"
                inputMode="numeric"
                autoComplete="off"
                value={residentRegistrationNumber}
                onChange={(e) => setResidentRegistrationNumber(e.target.value)}
                placeholder="000000-0000000"
              />
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <label className="field-label">주소</label>
            <input
              className="input"
              autoComplete="street-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="주소"
            />
          </div>

          <div className="grid grid-2" style={{ gap: 12, marginTop: 14 }}>
            <div>
              <label className="field-label">은행</label>
              <select className="select" value={bank} onChange={(e) => setBank(e.target.value)}>
                <option value="">은행 선택</option>
                {BANKS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">계좌번호</label>
              <input
                className="input"
                inputMode="numeric"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder="계좌번호"
              />
            </div>
          </div>

          <p className="muted small" style={{ margin: "10px 0 0" }}>
            주민번호와 계좌 정보는 본인 및 관리자 권한에서만 확인·수정됩니다.
          </p>

          {err && (
            <div className="alert-item danger" style={{ marginTop: 14 }}>
              <span>!</span>
              <div>{err}</div>
            </div>
          )}

          <div className="row" style={{ justifyContent: "space-between", marginTop: 18, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-outline" onClick={() => void logout()}>
              로그아웃
            </button>
            <div className="row">
              <button type="button" className="btn btn-outline" onClick={() => navigate(-1)}>
                취소
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}
