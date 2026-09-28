/**
 * 회원 탈퇴 — 마이페이지 맨 아래.
 *
 * 탈퇴하면 **계정만 닫힌다.** 데이터는 지우지 않고 남긴다(서버 routes/auth.py
 * withdraw 참고). 그래도 다시 로그인할 수 없게 되는 일이라 두 번 막는다.
 * 서버도 똑같이 막는다(화면만 믿지 않는다).
 *   · 확인 문구를 그대로 쳐야 단추가 켜진다 — 실수로 한 번 눌러 끝나지 않게
 *   · 일반 가입 계정은 비밀번호를 다시 받는다. 소셜 계정은 비밀번호를
 *     정한 적이 없으므로 묻지 않는다(서버가 알려 주는 oauth_provider 로 가른다)
 *
 * 무엇이 어떻게 되는지 **먼저** 적는다 — 무엇이 막히고, 무엇이 남는지.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import api from "@/api/client";
import { useAuthStore } from "@/store/authStore";
import { 요청실패말 } from "@/utils/errors";
import { UserX } from "lucide-react";

export const 탈퇴확인문구 = "탈퇴합니다";
/** 로그인 화면이 '탈퇴가 완료되었습니다' 를 띄울지 보는 표시 */
export const 탈퇴완료표시 = "stkplt_withdrawn";

type 내정보 = { id: number; username: string; oauth_provider?: string | null };

export default function 회원탈퇴() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const logout = useAuthStore((s) => s.logout);
  const [열림, set열림] = useState(false);
  const [비밀번호, set비밀번호] = useState("");
  const [문구, set문구] = useState("");

  const { data: 나 } = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => api.get<내정보>("/auth/me").then((r) => r.data),
    enabled: 열림,
    staleTime: 60_000,
  });
  const 소셜 = !!나?.oauth_provider;

  const 탈퇴 = useMutation({
    mutationFn: () => api.delete("/auth/me", {
      data: { confirm: 문구, ...(소셜 ? {} : { password: 비밀번호 }) },
    }),
    onSuccess: () => {
      /* 로그인 화면으로 보내고 거기서 '탈퇴가 완료되었습니다' 를 띄운다.
         어디로 보내든 마이페이지가 '로그인 안 됨' 을 보고 로그인 화면으로
         다시 보낼 수 있어서(둘이 경합한다), 도착지를 거기로 맞추고 알림은
         주소가 아니라 표시로 넘긴다 — 누가 먼저 옮기든 결과가 같다. */
      try { sessionStorage.setItem(탈퇴완료표시, "1"); } catch { /* 없어도 탈퇴는 됐다 */ }
      logout();
      qc.clear();
      navigate("/login", { replace: true });
    },
  });

  const 누를수있음 = 문구.trim() === 탈퇴확인문구 && (소셜 || 비밀번호.length > 0)
    && !!나 && !탈퇴.isPending;

  return (
    <div className="bg-bg-card border border-border rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <UserX size={14} className="text-accent-red" />
        <h2 className="text-sm font-bold text-text-primary">회원 탈퇴</h2>
      </div>

      {!열림 ? (
        <button
          type="button"
          onClick={() => set열림(true)}
          className="self-start text-xs text-text-muted hover:text-accent-red underline underline-offset-2"
        >
          탈퇴하기
        </button>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="text-xs text-text-secondary leading-relaxed break-keep">
            탈퇴하면 <b className="text-accent-red">이 계정으로 다시 로그인할 수 없어요.</b>
            <ul className="list-disc pl-4 mt-1.5 flex flex-col gap-0.5 text-text-muted">
              <li>쓴 글·댓글, 포트폴리오, 관심종목, 저장한 전략 등 기록은 지워지지 않고 남아요</li>
              <li>공개해 둔 포트폴리오는 비공개로 바뀌어요</li>
              <li>같은 아이디·소셜 계정으로는 다시 가입할 수 없어요</li>
            </ul>
          </div>

          {!소셜 && (
            <label className="flex flex-col gap-1">
              <span className="text-2xs font-semibold text-text-muted">비밀번호</span>
              <input
                type="password"
                autoComplete="current-password"
                value={비밀번호}
                onChange={(e) => set비밀번호(e.target.value)}
                className="bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-red"
              />
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-2xs font-semibold text-text-muted">
              확인을 위해 <b className="text-text-primary">{탈퇴확인문구}</b> 를 그대로 입력해 주세요
            </span>
            <input
              value={문구}
              onChange={(e) => set문구(e.target.value)}
              placeholder={탈퇴확인문구}
              className="bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-red"
            />
          </label>

          {탈퇴.isError && (
            <p role="alert" className="text-xs text-accent-red break-keep">
              {요청실패말(탈퇴.error, "탈퇴하지 못했어요. 잠시 후 다시 시도해 주세요")}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => { set열림(false); set비밀번호(""); set문구(""); 탈퇴.reset(); }}
              className="flex-1 py-2 text-sm rounded-lg border border-border text-text-secondary hover:text-text-primary"
            >
              취소
            </button>
            <button
              type="button"
              disabled={!누를수있음}
              onClick={() => 탈퇴.mutate()}
              className="flex-1 py-2 text-sm font-semibold rounded-lg bg-accent-red text-white disabled:opacity-40"
            >
              {탈퇴.isPending ? "처리 중…" : "탈퇴하기"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
