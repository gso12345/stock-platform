import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { communityApi } from "@/api/stocks";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { User, Save, Palette } from "lucide-react";

const AVATAR_COLORS_DISPLAY = [
  { label: "파랑",   dot: "bg-blue-500",    ring: "bg-blue-500/20 text-blue-400 border-blue-500/30"    },
  { label: "보라",   dot: "bg-purple-500",  ring: "bg-purple-500/20 text-purple-400 border-purple-500/30"  },
  { label: "초록",   dot: "bg-emerald-500", ring: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  { label: "황금",   dot: "bg-amber-500",   ring: "bg-amber-500/20 text-amber-400 border-amber-500/30"   },
  { label: "빨강",   dot: "bg-rose-500",    ring: "bg-rose-500/20 text-rose-400 border-rose-500/30"    },
  { label: "하늘",   dot: "bg-cyan-500",    ring: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30"    },
  { label: "남색",   dot: "bg-indigo-500",  ring: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30"  },
  { label: "오렌지", dot: "bg-orange-500",  ring: "bg-orange-500/20 text-orange-400 border-orange-500/30"  },
];

export default function MyPage() {
  const { isLoggedIn, username } = useAuthStore();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    if (!isLoggedIn) navigate("/login");
  }, [isLoggedIn, navigate]);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["myProfile"],
    queryFn: communityApi.getMyProfile,
    enabled: isLoggedIn,
  });

  const [nickname, setNickname] = useState("");
  const [avatarColor, setAvatarColor] = useState(0);
  const [bio, setBio] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setNickname(profile.nickname ?? "");
      setAvatarColor(profile.avatar_color ?? 0);
      setBio(profile.bio ?? "");
    }
  }, [profile]);

  const updateMutation = useMutation({
    mutationFn: () =>
      communityApi.updateMyProfile({ nickname: nickname.trim(), avatar_color: avatarColor, bio: bio.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["myProfile"] });
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (e: any) => {
      const detail = e?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "저장에 실패했습니다.");
    },
  });

  if (!isLoggedIn) return null;

  const displayName = nickname.trim() || username || "?";
  const colorCls = AVATAR_COLORS_DISPLAY[avatarColor % AVATAR_COLORS_DISPLAY.length];

  return (
    <div className="max-w-lg mx-auto py-6 flex flex-col gap-6">
      {/* 페이지 헤더 */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-2xl bg-accent-blue/10 flex items-center justify-center">
          <User size={20} className="text-accent-blue" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-text-primary">마이페이지</h1>
          <p className="text-xs text-text-dim">프로필을 설정하세요</p>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-bg-card border border-border rounded-2xl p-6 animate-pulse flex flex-col gap-4">
          <div className="h-4 bg-bg-elevated rounded w-32" />
          <div className="h-10 bg-bg-elevated rounded" />
          <div className="h-4 bg-bg-elevated rounded w-24" />
          <div className="h-20 bg-bg-elevated rounded" />
        </div>
      ) : (
        <div className="bg-bg-card border border-border rounded-2xl p-6 flex flex-col gap-5">

          {/* 아바타 미리보기 */}
          <div className="flex items-center gap-3 pb-1">
            <div
              className={`w-14 h-14 rounded-full border-2 flex items-center justify-center font-bold text-xl shrink-0 ${colorCls.ring}`}
            >
              {displayName[0]?.toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold text-text-primary">{displayName}</p>
              <p className="text-xs text-text-dim">@{username}</p>
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* 아이디 (읽기 전용) */}
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-1.5">아이디</label>
            <input
              readOnly
              value={username ?? ""}
              className="w-full px-3 py-2.5 bg-bg-elevated border border-border rounded-xl text-sm text-text-dim cursor-not-allowed focus:outline-none"
            />
          </div>

          {/* 닉네임 */}
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-1.5">닉네임</label>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="닉네임을 입력하세요 (미설정 시 아이디로 표시)"
              maxLength={50}
              className="w-full px-3 py-2.5 bg-bg-elevated border border-border rounded-xl text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50 transition-colors"
            />
            <p className="text-2xs text-text-dim mt-1">{nickname.length}/50</p>
          </div>

          {/* 아바타 색상 */}
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-2">
              <span className="flex items-center gap-1.5">
                <Palette size={11} /> 아바타 색상
              </span>
            </label>
            <div className="flex gap-2 flex-wrap">
              {AVATAR_COLORS_DISPLAY.map((c, idx) => (
                <button
                  key={idx}
                  onClick={() => setAvatarColor(idx)}
                  title={c.label}
                  className={`w-8 h-8 rounded-full ${c.dot} transition-all ${
                    avatarColor === idx
                      ? "ring-2 ring-offset-2 ring-offset-bg-card ring-white/60 scale-110"
                      : "opacity-50 hover:opacity-100 hover:scale-105"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* 소개 */}
          <div>
            <label className="block text-xs font-semibold text-text-muted mb-1.5">소개</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="간단한 자기소개를 입력하세요"
              maxLength={200}
              rows={3}
              className="w-full px-3 py-2.5 bg-bg-elevated border border-border rounded-xl text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-blue/50 resize-none transition-colors"
            />
            <p className="text-2xs text-text-dim mt-1">{bio.length}/200</p>
          </div>

          {/* 오류 */}
          {error && (
            <p className="text-xs text-accent-red">{error}</p>
          )}

          {/* 저장 버튼 */}
          <button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-accent-blue text-white text-sm font-semibold hover:bg-accent-blue/90 active:scale-[0.98] disabled:opacity-50 transition-all"
          >
            <Save size={14} />
            {updateMutation.isPending ? "저장 중..." : saved ? "저장됐습니다!" : "저장하기"}
          </button>
        </div>
      )}
    </div>
  );
}
