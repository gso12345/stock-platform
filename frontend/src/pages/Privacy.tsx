import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const SECTIONS = [
  {
    title: "1. 수집하는 개인정보 항목",
    content: `StockPlatform은 서비스 제공을 위해 아래와 같은 정보를 수집합니다.\n\n[회원가입 시]\n- 일반 회원가입: 아이디, 비밀번호(암호화 저장), 이메일(선택)\n- 소셜 로그인(Google·Kakao·Naver): 소셜 계정 고유 식별자, 이메일 주소, 이름 또는 닉네임(아이디 자동 생성에 사용)\n\n[이용자가 직접 입력한 정보]\n- 프로필: 닉네임, 자기소개, 프로필 사진\n- 커뮤니티: 게시글, 댓글, 좋아요, 투표, 팔로우, 신고 내용\n- 관심종목, 포트폴리오, 백테스트 전략·실험, 스크리닝 조건, 가격 알림, 알림 설정, 메모 등 서비스 이용 중 입력한 데이터\n\n[자동 수집 항목]\n- 서비스 이용 과정에서 IP 주소, 브라우저 종류 등 접속 정보가 서버 호스팅 업체의 로그에 남을 수 있습니다. 서비스는 방문자 수 집계를 위해 이 정보를 서버 메모리에서만 잠시 사용하며 별도로 저장하지 않습니다.`,
  },
  {
    title: "2. 개인정보의 수집 및 이용 목적",
    content: `수집한 개인정보는 다음 목적에만 사용합니다.\n- 회원 식별 및 로그인 인증\n- 개인화된 서비스 제공 (관심종목, 포트폴리오, 백테스트 기록 저장)\n- 커뮤니티 기능 제공 (게시글·댓글 작성자 표시, 팔로우, 알림)\n- 불법 이용 방지 및 서비스 보안 유지 (신고 처리, 이용 제한)\n- 서비스 개선을 위한 통계 분석 (개인 식별 불가 형태)`,
  },
  {
    title: "3. 다른 이용자에게 공개되는 정보",
    content: `다음 정보는 서비스의 다른 이용자에게 보일 수 있습니다.\n- 커뮤니티에 작성한 게시글·댓글과 작성자의 닉네임·프로필 사진·자기소개\n- 팔로우 관계\n- 이용자가 '공개'로 설정한 포트폴리오 (보유 종목과 비중 등)\n\n포트폴리오는 기본적으로 비공개이며, 공개 여부는 이용자가 언제든지 바꿀 수 있습니다.`,
  },
  {
    title: "4. 개인정보의 보유 및 이용 기간",
    content: `① 회원이 탈퇴하면 계정은 즉시 닫혀 더 이상 로그인할 수 없습니다. 다만 게시글·댓글, 포트폴리오, 관심종목 등 서비스 이용 기록과 계정 정보는 삭제하지 않고 보관합니다.\n② 탈퇴할 때 공개로 설정해 둔 포트폴리오는 비공개로 바뀝니다. 게시글·댓글은 작성자 표시와 함께 계속 공개될 수 있습니다.\n③ 탈퇴 후 보관 중인 정보의 삭제를 원하면 아래 개인정보 보호책임자 이메일로 요청해 주세요. 요청을 받으면 지체 없이 삭제합니다.\n④ 관계 법령에 따라 보존이 필요한 정보는 해당 법령이 정한 기간 동안 보관합니다.`,
  },
  {
    title: "5. 개인정보의 제3자 제공",
    content: `StockPlatform은 이용자의 개인정보를 원칙적으로 외부에 제공하지 않습니다. 단, 다음의 경우는 예외입니다.\n- 이용자가 사전에 동의한 경우\n- 법령에 의해 제공이 요구되는 경우 (수사기관의 적법한 요청 등)`,
  },
  {
    title: "6. 개인정보 처리 위탁 및 국외 이전",
    content: `서비스 운영을 위해 아래와 같이 개인정보 처리를 위탁하며, 이 과정에서 개인정보가 국외에 저장·처리됩니다.\n\n- Render Services, Inc. (미국) — 서버 운영. 서버는 싱가포르 지역에 있습니다.\n- Vercel Inc. (미국) — 웹사이트 호스팅 및 전송\n\n이전되는 항목: 제1항의 개인정보 전부\n이전 시기·방법: 서비스 이용 시 네트워크를 통해 전송\n보유 기간: 제4항의 보유 기간과 같음\n\n위탁 업체는 위탁 목적 외 개인정보를 처리하지 않습니다.`,
  },
  {
    title: "7. 소셜 로그인",
    content: `Google·Kakao·Naver 계정으로 로그인하면, 이용자가 해당 업체 화면에서 동의한 범위 안에서 제1항의 정보(고유 식별자, 이메일, 이름 또는 닉네임)를 해당 업체로부터 받습니다. 서비스는 이 업체들에 이용자의 서비스 이용 정보를 보내지 않습니다.`,
  },
  {
    title: "8. 로컬스토리지의 사용",
    content: `서비스는 로그인 상태 유지를 위해 로그인 토큰을, 화면 설정(테마·색상 등)을 기억하기 위해 설정값을 브라우저 로컬스토리지에 저장합니다. 브라우저 설정에서 사이트 데이터를 지우면 삭제됩니다.`,
  },
  {
    title: "9. 이용자의 권리",
    content: `이용자는 언제든지 다음과 같은 권리를 행사할 수 있습니다.\n- 개인정보 열람 요청\n- 오류가 있는 개인정보 정정 요청\n- 개인정보 삭제 요청\n- 개인정보 처리 정지 요청\n\n회원 탈퇴는 마이페이지의 '회원 탈퇴' 에서 직접 할 수 있습니다. 탈퇴해도 기록은 삭제되지 않으며(제4항), 삭제는 이메일로 요청할 수 있습니다. 프로필과 포트폴리오 공개 여부도 서비스 안에서 직접 바꿀 수 있습니다. 그 밖의 권리 행사는 아래 개인정보 보호책임자 이메일로 요청해 주세요.`,
  },
  {
    title: "10. 개인정보의 안전성 확보 조치",
    content: `- 비밀번호는 PBKDF2-SHA256 방식으로 복호화할 수 없게 암호화하여 저장합니다.\n- HTTPS 암호화 통신을 통해 데이터를 전송합니다.\n- 접근 권한을 최소화하여 개인정보 접근을 통제합니다.\n- 정기적인 보안 점검을 실시합니다.`,
  },
  {
    title: "11. 개인정보 보호책임자",
    content: `개인정보 처리에 관한 문의·불만·피해 구제는 아래로 연락 주시기 바랍니다.\n\n개인정보 보호책임자\n이메일: privacy@stockplatform.kr`,
  },
  {
    title: "12. 개인정보처리방침 변경",
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
          <p className="text-xs text-text-muted mb-8">최종 수정일: 2026년 9월 28일</p>

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
