import type { CSSProperties } from "react";
import { ArrowLeft } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/components/ui";

/**
 * 뒤로 가기 — 글자 없이 화살표만(앱들처럼).
 *
 * 로그인·이용약관·개인정보처리방침은 "← 뒤로가기" 글자 단추였다. 글자가 붙은 뒤로 단추는 웹페이지 티가 났다
 * (사용자: "로그인할 때 뒤로가기 글자 써져 있는 거 디자인적으로 안 좋은 것 같아"). 손가락 크기(44px)·모양은
 * 종목 상세의 뒤로 단추와 같다.
 *
 * 이 앱 안에서 들어온 기록이 없으면(주소로 바로 열었거나 회원가입에서 새 탭으로 연 약관) 뒤로 갈 곳이
 * 앱 밖이거나 없다 — 그때는 첫 화면으로 간다. 예전에는 눌러도 아무 일이 없거나 앱을 벗어났다.
 */
export function BackButton({ className, style }: { className?: string; style?: CSSProperties }) {
  const navigate = useNavigate();
  const { key } = useLocation();
  return (
    <button
      type="button"
      aria-label="뒤로 가기"
      title="뒤로 가기"
      // 처음 연 화면의 key 는 "default" 다(react-router) — 그 앞은 이 앱이 아니다
      onClick={() => (key === "default" ? navigate("/", { replace: true }) : navigate(-1))}
      className={cn(
        "w-11 h-11 -ml-2 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors",
        className,
      )}
      style={style}
    >
      <ArrowLeft size={20} />
    </button>
  );
}
