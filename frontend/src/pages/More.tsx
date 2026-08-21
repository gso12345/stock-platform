/**
 * 더보기 화면.
 *
 * 예전에는 하단 탭의 "더보기"가 바텀시트를 올렸다. 그 안에 메뉴가 5칸짜리
 * 격자로 들어가 있어서, 아이콘 밑에 두세 글자만 붙은 칸들이 늘어섰다.
 * "전략저장소"는 줄바꿈돼 뭉개졌고, 메뉴가 하나 늘 때마다 격자가 흐트러졌다.
 * 시트라서 뒤로가기로 닫히지도 않았다.
 *
 * 그래서 화면으로 냈다. 메뉴는 줄로 세우고(글자가 길어도 상관없다), 맨 위에는
 * 내 프로필을 얹었다 — 여기가 앱에서 "나" 를 여는 유일한 입구라서, 프로필이
 * 보이지 않으면 내 정보를 고치러 어디로 가야 하는지 알 수 없었다.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Star, User, Bell, Settings, LogOut, LogIn, ShieldCheck, ChevronRight, Pencil,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { communityApi } from "@/api/stocks";
import { useMyProfile } from "@/hooks/useMyProfile";
import Avatar from "@/components/community/Avatar";
import InstallAppButton from "@/components/InstallAppButton";
import SettingsModal from "@/components/SettingsModal";
import { 더보기_메뉴 } from "@/constants/moreNav";

function 줄({ to, onClick, icon: Icon, label, 설명, badge, 위험 }: {
  to?: string; onClick?: () => void; icon: typeof Star; label: string;
  설명?: string; badge?: string | null; 위험?: boolean;
}) {
  const 안쪽 = (
    <>
      <span className="relative shrink-0">
        <Icon size={18} className={위험 ? "text-accent-red" : "text-text-muted"} />
        {badge ? (
          <span className="absolute -top-1.5 -right-2 min-w-[15px] h-[15px] px-0.5 flex items-center justify-center rounded-full bg-accent-red text-white text-2xs font-bold leading-none">
            {badge}
          </span>
        ) : null}
      </span>
      <span className="flex-1 min-w-0 flex flex-col">
        <span className={`text-sm font-semibold ${위험 ? "text-accent-red" : "text-text-primary"}`}>{label}</span>
        {설명 && <span className="text-2xs text-text-dim truncate">{설명}</span>}
      </span>
      <ChevronRight size={15} className="text-text-dim shrink-0" />
    </>
  );
  const cls = "w-full flex items-center gap-3.5 px-4 py-3.5 text-left hover:bg-bg-elevated active:bg-bg-elevated transition-colors";
  return to
    ? <Link to={to} className={cls}>{안쪽}</Link>
    : <button onClick={onClick} className={cls}>{안쪽}</button>;
}

export default function More() {
  const { isLoggedIn, username, isAdmin, logout } = useAuthStore();
  const navigate = useNavigate();
  const [설정열림, set설정열림] = useState(false);
  const { displayName, avatarColor, avatarUrl, userId } = useMyProfile();

  /* Layout 의 종·마이페이지와 같은 질의 키 → 요청이 새로 안 나간다 */
  const { data: notiUnread } = useQuery({
    queryKey: ["notiUnread"],
    queryFn: communityApi.getUnreadNotificationCount,
    enabled: isLoggedIn,
    staleTime: 30_000,
  });
  const notiBadge = !notiUnread?.count ? null : notiUnread.capped ? "99+" : String(notiUnread.count);

  const { data: 공개프로필 } = useQuery({
    queryKey: ["userPublicProfile", userId],
    queryFn: () => communityApi.getUserPublicProfile(userId!),
    enabled: isLoggedIn && !!userId,
    staleTime: 120_000,
  });

  const { data: 내프로필 } = useQuery({
    queryKey: ["myProfile"],
    queryFn: communityApi.getMyProfile,
    enabled: isLoggedIn,
    staleTime: 120_000,
  });

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4">
      <h1 className="text-xl font-bold text-text-primary">더보기</h1>

      {/* ── 내 프로필 ─────────────────────────────── */}
      {isLoggedIn ? (
        <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
          <Link to="/mypage" className="flex items-center gap-3.5 px-4 py-4 hover:bg-bg-elevated transition-colors">
            <Avatar username={displayName} colorIndex={avatarColor} avatarUrl={avatarUrl} size="lg" />
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold text-text-primary truncate">{displayName}</p>
              <p className="text-xs text-text-dim truncate">@{username}</p>
              {(내프로필 as any)?.bio && (
                <p className="text-xs text-text-secondary mt-1 line-clamp-2 break-keep">{(내프로필 as any).bio}</p>
              )}
            </div>
            <ChevronRight size={16} className="text-text-dim shrink-0" />
          </Link>

          {/* 팔로워·팔로잉·게시글 — 아직 안 왔으면 아예 안 그린다.
              0 을 먼저 보여줬다가 숫자가 튀면 잘못 읽는다 */}
          {공개프로필 && (
            <div className="grid grid-cols-3 border-t border-border-subtle">
              {([
                ["팔로워",  (공개프로필 as any).follower_count],
                ["팔로잉",  (공개프로필 as any).following_count],
                ["게시글",  (공개프로필 as any).post_count],
              ] as const).map(([label, 값]) => (
                <div key={label} className="flex flex-col items-center py-3">
                  <span className="text-base font-bold text-text-primary">{값 ?? 0}</span>
                  <span className="text-2xs text-text-dim">{label}</span>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-border-subtle p-3">
            <button
              onClick={() => navigate("/mypage?edit=1")}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-border text-sm font-semibold text-text-secondary hover:border-accent-blue/50 hover:text-accent-blue transition-all"
            >
              <Pencil size={13} />
              프로필 수정
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
          <button
            onClick={() => navigate("/login")}
            className="w-full flex items-center justify-center gap-2.5 py-5 text-sm text-text-muted hover:text-accent-blue hover:bg-accent-blue/5 transition-all"
          >
            <LogIn size={15} />
            로그인하고 시작하기
          </button>
        </div>
      )}

      {/* ── 메뉴 ─────────────────────────────────── */}
      <div className="bg-bg-card border border-border rounded-2xl overflow-hidden divide-y divide-border-subtle">
        {isLoggedIn && (
          <줄 to="/notifications" icon={Bell} label="알림" 설명="댓글·좋아요·팔로우" badge={notiBadge} />
        )}
        {더보기_메뉴.map((m) => (
          <줄 key={m.to} to={m.to} icon={m.icon} label={m.label} 설명={m.설명} />
        ))}
        {isLoggedIn && <줄 to="/mypage" icon={User} label="내 프로필" 설명="내 글·자산 공개 설정" />}
        {isAdmin && <줄 to="/admin" icon={ShieldCheck} label="관리자" 설명="공지·팝업·사용자 관리" />}
      </div>

      {/* ── 앱 · 설정 ─────────────────────────────── */}
      <div className="bg-bg-card border border-border rounded-2xl overflow-hidden divide-y divide-border-subtle">
        <InstallAppButton
          iconSize={18}
          className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left text-sm font-semibold text-text-primary hover:bg-bg-elevated transition-colors"
        />
        <줄 onClick={() => set설정열림(true)} icon={Settings} label="설정" 설명="테마·화면 모양·글씨 크기·알림" />
        {isLoggedIn && (
          <줄 onClick={() => { logout(); navigate("/login"); }} icon={LogOut} label="로그아웃" 위험 />
        )}
      </div>

      {설정열림 && <SettingsModal onClose={() => set설정열림(false)} />}
    </div>
  );
}
