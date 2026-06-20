import { Link } from "react-router-dom";
import { Card, Badge } from "../components/ui";
import { useStore } from "../store";

const guideSections = [
  {
    title: "신규 직원 추가",
    icon: "👥",
    points: [
      "관리자가 직원 관리 화면에서 회원가입 링크를 복사합니다.",
      "직원에게 링크를 보내고, 직원이 이름·이메일·비밀번호·연락처·급여 계좌를 입력해 가입합니다.",
      "가입이 끝나면 Firebase Auth 계정과 직원 문서가 자동 생성되고 직원번호가 자동 발급됩니다.",
      "기본 권한은 실무자이며, 필요하면 관리자가 직원 관리 화면에서 매니저로 변경합니다.",
    ],
  },
  {
    title: "근무표 배치",
    icon: "🗓️",
    points: [
      "근무표 관리에서 요일과 오전/오후, 홀/주방 칸을 선택합니다.",
      "오른쪽 또는 아래 배치 패널에서 직원을 여러 명 체크합니다.",
      "선택 추가를 누르면 한 번에 여러 명이 해당 칸에 배치됩니다.",
      "잘못 배치한 직원은 배치된 직원 목록에서 삭제할 수 있습니다.",
    ],
  },
  {
    title: "권한 기준",
    icon: "🔐",
    points: [
      "관리자는 직원 권한, 급여, 근무표, 예약, 공지까지 모두 관리합니다.",
      "매니저는 예약, 근무표, 공지/전달사항 같은 운영 업무를 관리합니다.",
      "매니저는 급여 관리와 직원 권한 변경 화면에는 접근하지 못합니다.",
      "관리자 승격은 앱 화면에서 하지 않고 Firebase 콘솔 또는 별도 관리자 기능으로 처리합니다.",
    ],
  },
  {
    title: "급여 관리",
    icon: "💰",
    points: [
      "급여 관리는 관리자만 볼 수 있습니다.",
      "정직원은 월급 기준으로 관리하고, 아르바이트는 시급 또는 슬롯 기준으로 계산합니다.",
      "근무기록 승인, 추가수당, 차감, 최종 지급액 확인은 급여 관리 화면에서 처리합니다.",
    ],
  },
];

export default function Guide() {
  const { role, showToast } = useStore();
  const signupUrl = `${window.location.origin}/signup`;
  const canManageEmployees = role === "admin";

  const copySignupLink = async () => {
    try {
      await navigator.clipboard.writeText(signupUrl);
      showToast("회원가입 링크를 복사했습니다");
    } catch {
      showToast(signupUrl);
    }
  };

  return (
    <>
      <Card>
        <div className="guide-hero">
          <div>
            <Badge tone={role === "admin" ? "green" : "blue"}>
              {role === "admin" ? "관리자용" : "매니저용"}
            </Badge>
            <h2>하늘땅 매장관리 사용 가이드북</h2>
            <p>
              직원 추가, 근무표 배치, 권한 기준을 한 화면에서 확인할 수 있습니다.
              처음 쓰는 사람도 이 순서대로만 보면 운영이 됩니다.
            </p>
          </div>
          <div className="guide-actions">
            {canManageEmployees && (
              <>
                <button className="btn btn-primary" onClick={copySignupLink}>
                  회원가입 링크 복사
                </button>
                <Link className="btn btn-outline" to="/employees">
                  직원 관리로 이동
                </Link>
              </>
            )}
            <Link className="btn btn-outline" to="/schedule-manage">
              근무표 관리로 이동
            </Link>
          </div>
        </div>
      </Card>

      <div className="guide-grid">
        {guideSections.map((section) => (
          <Card key={section.title} title={section.title} icon={section.icon}>
            <ol className="guide-list">
              {section.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ol>
          </Card>
        ))}
      </div>

      <Card title="직원 추가가 실제로 저장되는 방식" icon="🧾">
        <div className="guide-note-grid">
          <div>
            <strong>1. Auth 계정</strong>
            <p>직원이 회원가입하면 이메일/비밀번호 로그인 계정이 Firebase Auth에 생성됩니다.</p>
          </div>
          <div>
            <strong>2. 사용자 프로필</strong>
            <p><code>users/uid</code> 문서가 만들어지고 이름, 권한, 매장ID, 직원번호가 저장됩니다.</p>
          </div>
          <div>
            <strong>3. 직원 문서</strong>
            <p><code>stores/haneulttang/employees/직원번호</code> 문서가 만들어져 근무표와 급여 계산에 사용됩니다.</p>
          </div>
          <div>
            <strong>4. 직원번호</strong>
            <p><code>employeeCounter</code> 값이 1씩 증가하면서 새 직원번호가 자동 발급됩니다.</p>
          </div>
        </div>
      </Card>
    </>
  );
}
