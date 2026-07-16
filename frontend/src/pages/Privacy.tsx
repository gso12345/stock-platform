import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const SECTIONS = [
  {
    title: "1. 수집하는 개인정보 항목",
    content: `StockPlatform은 서비스 제공을 위해 아래와 같은 정보를 수집합니다.\n\n[필수 항목]\n- 일반 회원가입: 아이디, 비밀번호(암호화 저장)\n- 소셜 로그인(Google·Kakao·Naver): 이메일 주소, 소셜 계정 고유 식별자\n\n[자동 수집 항목]\n- 서비스 이용 기록, 접속 로그, IP 주소\n- 기기 정보(브라우저 종류·버전, OS)\n\n[이용자가 직접 입력한 정보]\n- 관심종목, 포트폴리오 데이터, 메모 등 서비스 이용 중 입력한 데이터`,
  },
  {
    title: "2. 개인정보의 수집 및 이용 목적",
    content: `수집한 개인정보는 다음 목적에만 사용합니다.\n- 회원 식별 및 로그인 인증\n- 개인화된 서비스 제공 (관심종목, 포트폴리오 동기화)\n- 불법 이용 방지 및 서비스 보안 유지\n- 서비스 개선을 위한 통계 분석 (개인 식별 불가 형태)`,
  },
  {
    title: "3. 개인정보의 보유 및 이용 기간",
    content: `① 회원 탈퇴 시 지체 없이 개인정보를 파기합니다.\n② 단, 법령에 의해 보존이 필요한 경우 해당 기간 동안 보관합니다.\n  - 서비스 이용 관련 분쟁 기록: 3년 (소비자보호법)\n  - 접속 로그: 3개월 (통신비밀보호법)`,
  },
  {
    title: "4. 개인정보의 제3자 제공",
    content: `StockPlatform은 이용자의 개인정보를 원칙적으로 외부에 제공하지 않습니다. 단, 다음의 경우는 예외입니다.\n- 이용자가 사전에 동의한 경우\n- 법령에 의해 제공이 요구되는 경우 (수사기관의 적법한 요청 등)`,
  },
  {
    title: "5. 개인정보 처리 위탁",
    content: `서비스 운영을 위해 아래와 같이 개인정보 처리를 위탁합니다.\n\n| 수탁 업체 | 위탁 업무 |\n|---|---|\n| Google LLC | 소셜 로그인 (Google OAuth) |\n| Kakao Corp. | 소셜 로그인 (Kakao OAuth) |\n| NAVER Corp. | 소셜 로그인 (Naver OAuth) |\n\n위탁 업체는 위탁 목적 외 개인정보를 처리하지 않습니다.`,
  },
  {
    title: "6. 쿠키(Cookie)의 사용",
    content: `서비스는 로그인 상태 유지를 위해 JWT 토큰을 브라우저 로컬스토리지에 저장합니다. 이는 쿠키와 유사한 방식으로 동작하며, 브라우저 설정에서 로컬스토리지를 초기화하면 삭제됩니다.`,
  },
  {
    title: "7. 이용자의 권리",
    content: `이용자는 언제든지 다음과 같은 권리를 행사할 수 있습니다.\n- 개인정보 열람 요청\n- 오류가 있는 개인정보 정정 요청\n- 개인정보 삭제 요청 (회원 탈퇴)\n- 개인정보 처리 정지 요청\n\n위 권리 행사는 서비스 내 설정 또는 아래 이메일로 요청 가능합니다.`,
  },
  {
    title: "8. 개인정보의 안전성 확보 조치",
    content: `- 비밀번호는 bcrypt 알고리즘으로 암호화하여 저장합니다.\n- HTTPS 암호화 통신을 통해 데이터를 전송합니다.\n- 접근 권한을 최소화하여 개인정보 접근을 통제합니다.\n- 정기적인 보안 점검을 실시합니다.`,
  },
  {
    title: "9. 개인정보 보호책임자",
    content: `개인정보 처리에 관한 문의·불만·피해 구제는 아래로 연락 주시기 바랍니다.\n\n개인정보 보호책임자\n이메일: privacy@stockplatform.kr`,
  },
  {
    title: "10. 개인정보처리방침 변경",
    content: `이 개인정보처리방침은 법령·정책 또는 보안 기술 변경에 따라 개정될 수 있습니다. 변경 시 서비스 내 공지사항을 통해 7일 전에 안내합니다.`,
  },
];

export default function Privacy() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-bg-base px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors mb-6"
        >
          <ArrowLeft size={14} />뒤로가기
        </button>

        <div className="bg-bg-card border border-border rounded-2xl p-6 md:p-8">
          <h1 className="text-xl font-bold text-text-primary mb-1">개인정보처리방침</h1>
          <p className="text-xs text-text-muted mb-8">최종 수정일: 2026년 7월 16일</p>

          <div className="flex flex-col gap-6">
            {SECTIONS.map((s) => (
              <div key={s.title}>
                <h2 className="text-sm font-semibold text-text-primary mb-2">{s.title}</h2>
                <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-line">{s.content}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
