import { useEffect, useState } from "react";
import api, { API_BASE } from "@/api/client";

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
  );
}

function NaverIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path fill="#fff" d="M11.4 9.6L6.6 3H3.6V15H6.6V8.4L11.4 15H14.4V3H11.4V9.6Z" />
    </svg>
  );
}

function KakaoIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path fill="#191919" d="M9 1.5C4.5 1.5 1 4.3 1 7.8c0 2.2 1.4 4.2 3.6 5.4l-.9 3.3c-.1.3.2.6.5.4l3.9-2.6c.6.1 1.2.1 1.9.1 4.5 0 8-2.8 8-6.3S13.5 1.5 9 1.5z" />
    </svg>
  );
}

const PROVIDERS = [
  {
    id: "google",
    label: "Google로 계속하기",
    /* 구글 규정상 흰 바탕에 검은 글씨여야 한다. 토큰으로 바꾸면
       테마에 따라 색이 변해 규정을 어긴다 — 여기만 예외다 */
    className: "bg-white text-gray-800 border border-border hover:bg-gray-50",
    icon: <GoogleIcon />,
  },
  {
    id: "naver",
    label: "네이버로 계속하기",
    className: "bg-[#03C75A] text-white hover:bg-[#02b350]",
    icon: <NaverIcon />,
  },
  {
    id: "kakao",
    label: "카카오로 계속하기",
    className: "bg-[#FEE500] text-[#191919] hover:bg-[#fada00]",
    icon: <KakaoIcon />,
  },
] as const;

/* 서버가 '끝까지 로그인할 수 있다' 고 한 공급자만 누를 수 있게 한다.
   열쇠가 덜 들어간 공급자를 누르면 공급자 화면에 갔다가 오류로 돌아온다 —
   그것보다는 '준비중' 이라고 먼저 말하는 편이 낫다. 서버에 못 물으면
   모두 준비중으로 둔다(누르면 실패할 것을 켜 두지 않는다). */
export function useSocialProviders(): Set<string> {
  const [켜짐, set켜짐] = useState<Set<string>>(new Set());
  useEffect(() => {
    let 살아있음 = true;
    api.get<{ providers: string[] }>("/auth/oauth/providers")
      .then(({ data }) => { if (살아있음) set켜짐(new Set(data?.providers ?? [])); })
      .catch(() => {});
    return () => { 살아있음 = false; };
  }, []);
  return 켜짐;
}

export default function SocialLoginButtons() {
  const [notice, setNotice] = useState(false);
  const 켜짐 = useSocialProviders();
  const 공통 = "flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-sm font-semibold transition-all";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 my-1">
        <div className="flex-1 h-px bg-border" />
        <span className="text-2xs text-text-dim">또는</span>
        <div className="flex-1 h-px bg-border" />
      </div>
      {PROVIDERS.map((p) =>
        켜짐.has(p.id) ? (
          /* 페이지째 넘어가야 한다 — 공급자 화면을 거쳐 서버 콜백으로 돌아오는 길이라
             fetch 로는 안 된다 */
          <a key={p.id} href={`${API_BASE}/auth/oauth/${p.id}/login`} className={`${공통} ${p.className}`}>
            {p.icon}
            {p.label}
          </a>
        ) : (
          <button
            key={p.id}
            type="button"
            onClick={() => setNotice(true)}
            aria-disabled="true"
            className={`${공통} ${p.className} opacity-60`}
          >
            {p.icon}
            {p.label}
          </button>
        ),
      )}
      {notice && (
        <p className="text-2xs text-text-muted text-center mt-1">이 로그인 방식은 아직 준비중이에요.</p>
      )}
    </div>
  );
}
