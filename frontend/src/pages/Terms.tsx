import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const SECTIONS = [
  {
    title: "제1조 (목적)",
    content: `이 약관은 StockPlatform(이하 "서비스")이 제공하는 주식 정보 분석 서비스의 이용 조건 및 절차, 이용자와 운영자의 권리·의무 및 책임 사항을 규정함을 목적으로 합니다.`,
  },
  {
    title: "제2조 (용어의 정의)",
    content: `① "서비스"란 운영자가 제공하는 주식 분석, 퀀트 스크리닝, 백테스트, 포트폴리오 관리 등 일체의 기능을 말합니다.\n② "회원"이란 이 약관에 동의하고 서비스를 이용하는 자를 말합니다.\n③ "비회원"이란 회원 가입 없이 서비스의 일부를 이용하는 자를 말합니다.`,
  },
  {
    title: "제3조 (약관의 효력 및 변경)",
    content: `① 이 약관은 서비스 화면에 게시하거나 기타 방법으로 회원에게 공지함으로써 효력이 발생합니다.\n② 운영자는 합리적인 사유가 있는 경우 약관을 변경할 수 있으며, 변경 시 최소 7일 전에 공지합니다.\n③ 회원이 변경된 약관에 동의하지 않을 경우 서비스 이용을 중단하고 회원 탈퇴를 요청할 수 있습니다.`,
  },
  {
    title: "제4조 (서비스 이용)",
    content: `① 서비스는 연중무휴 24시간 제공을 원칙으로 합니다. 단, 시스템 점검·장애 등의 경우 일시적으로 중단될 수 있습니다.\n② 본 서비스가 제공하는 모든 정보는 투자 참고 자료이며, 투자 권유 또는 투자 자문에 해당하지 않습니다.\n③ 투자 결과에 대한 책임은 전적으로 이용자 본인에게 있습니다.`,
  },
  {
    title: "제5조 (회원 가입)",
    content: `① 회원 가입은 서비스 내 가입 양식에 정보를 입력하고 이 약관에 동의함으로써 완료됩니다.\n② 운영자는 다음 각 호에 해당하는 경우 가입을 거절할 수 있습니다.\n  - 타인의 명의를 도용한 경우\n  - 허위 정보를 기재한 경우\n  - 이전에 이용 제한된 회원인 경우`,
  },
  {
    title: "제6조 (회원의 의무)",
    content: `① 회원은 자신의 계정 정보를 안전하게 관리해야 하며, 타인에게 양도하거나 대여할 수 없습니다.\n② 회원은 다음 행위를 해서는 안 됩니다.\n  - 서비스의 안정적 운영을 방해하는 행위\n  - 서비스를 이용해 타인에게 허위 정보를 유포하는 행위\n  - 자동화된 방법으로 서비스를 대량 이용하는 행위\n  - 서비스의 지적재산권을 침해하는 행위`,
  },
  {
    title: "제7조 (서비스 이용 제한)",
    content: `운영자는 회원이 이 약관의 의무를 위반하거나 서비스의 정상적인 운영을 방해한 경우, 경고 또는 서비스 이용 제한 조치를 취할 수 있습니다.`,
  },
  {
    title: "제8조 (정보 제공 면책)",
    content: `① 서비스는 Yahoo Finance 등 외부 데이터를 기반으로 정보를 제공합니다. 데이터의 정확성·완전성을 보장하지 않습니다.\n② 서비스 내 모든 분석 결과(퀀트점수, 백테스트 등)는 과거 데이터 기반의 참고 자료이며, 미래 수익을 보장하지 않습니다.\n③ 운영자는 정보 오류·지연으로 인한 투자 손실에 대해 책임지지 않습니다.`,
  },
  {
    title: "제9조 (회원 탈퇴)",
    content: `회원은 언제든지 탈퇴를 요청할 수 있으며, 탈퇴 시 회원의 데이터(포트폴리오, 관심종목 등)는 즉시 삭제됩니다. 단, 법령에 따라 보존이 필요한 정보는 해당 기간 동안 보관됩니다.`,
  },
  {
    title: "제10조 (준거법 및 관할)",
    content: `이 약관은 대한민국 법률에 따라 해석되며, 서비스 이용과 관련한 분쟁은 운영자의 소재지 관할 법원을 전속 관할로 합니다.`,
  },
];

export default function Terms() {
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
          <h1 className="text-xl font-bold text-text-primary mb-1">이용약관</h1>
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
