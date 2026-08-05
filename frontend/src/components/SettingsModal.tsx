/**
 * 설정 창.
 *
 * 예전에는 Layout 안에 들어 있었다. 더보기가 화면으로 나오면서 설정을 여는
 * 자리가 두 곳(사이드바, 더보기 화면)이 됐고, 둘 다 이걸 써야 해서 뺐다.
 */
import { Sun, Moon, Monitor, X, RectangleHorizontal, RectangleVertical, Smartphone } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore, 화면모양_목록 } from "@/store/settingsStore";
import type { ColorScheme, FontSize, Theme, Orientation, 화면모양 } from "@/store/settingsStore";
import { NotificationToggles } from "@/components/community/NotificationSettings";

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const { colorScheme, setColorScheme, fontSize, setFontSize, theme, setTheme, orientation, setOrientation,
          화면모양, set화면모양 } = useSettingsStore();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm max-h-[85vh] flex flex-col bg-bg-card border border-border rounded-2xl shadow-2xl overflow-hidden modal-pop">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h3 className="text-sm font-bold text-text-primary">설정</h3>
          <button onClick={onClose} aria-label="닫기" className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated">
            <X size={15} />
          </button>
        </div>
        <div className="px-5 py-5 flex flex-col gap-5 flex-1 overflow-y-auto">

          {/* 테마 */}
          <div>
            <p className="text-xs font-semibold text-text-muted mb-2">테마</p>
            <div className="flex gap-2">
              {([
                { value: "light",  label: "라이트", icon: Sun },
                { value: "dark",   label: "다크",   icon: Moon },
                { value: "system", label: "시스템", icon: Monitor },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTheme(opt.value as Theme)}
                  className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-all ${
                    theme === opt.value
                      ? "border-accent-blue bg-accent-blue/10"
                      : "border-border hover:border-accent-blue/40 hover:bg-bg-elevated"
                  }`}
                >
                  <opt.icon size={16} className="text-text-primary" />
                  <span className="text-[10px] text-text-muted">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 화면 모양 —
              내 자산·종목상세를 어떤 배치로 볼지. 무엇이 나은지는 사람마다
              갈려서 하나로 정하지 않고 고르게 뒀다. */}
          <div>
            <p className="text-xs font-semibold text-text-muted mb-2">화면 모양</p>
            <div className="flex flex-col gap-1.5">
              {화면모양_목록.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => set화면모양(opt.value as 화면모양)}
                  aria-pressed={화면모양 === opt.value}
                  className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                    화면모양 === opt.value
                      ? "border-accent-blue bg-accent-blue/10"
                      : "border-border hover:border-accent-blue/40 hover:bg-bg-elevated"
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    화면모양 === opt.value ? "bg-accent-blue" : "bg-bg-elevated border border-border"}`} />
                  <span className="flex flex-col min-w-0">
                    <span className="text-xs font-semibold text-text-primary">{opt.label}</span>
                    <span className="text-[10px] text-text-muted break-keep">{opt.desc}</span>
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-text-dim mt-1.5 break-keep">
              내 자산과 종목상세에 적용됩니다.
            </p>
          </div>

          {/* 등락 색상 */}
          <div>
            <p className="text-xs font-semibold text-text-muted mb-2">등락 색상</p>
            <div className="flex gap-2">
              {([
                { value: "green-red", label: "초록 / 빨강", desc: "상승=초록, 하락=빨강" },
                { value: "red-blue",  label: "빨강 / 파랑",  desc: "상승=빨강, 하락=파랑" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setColorScheme(opt.value as ColorScheme)}
                  className={`flex-1 flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${
                    colorScheme === opt.value
                      ? "border-accent-blue bg-accent-blue/10"
                      : "border-border hover:border-accent-blue/40 hover:bg-bg-elevated"
                  }`}
                >
                  <div className="flex gap-1.5">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${opt.value === "green-red" ? "text-accent-green bg-accent-green/10" : "text-accent-red bg-accent-red/10"}`}>▲</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${opt.value === "green-red" ? "text-accent-red bg-accent-red/10" : "text-accent-blue bg-accent-blue/10"}`}>▼</span>
                  </div>
                  <span className="text-xs font-semibold text-text-primary">{opt.label}</span>
                  <span className="text-[10px] text-text-muted text-center leading-tight">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 글씨 크기 */}
          <div>
            <p className="text-xs font-semibold text-text-muted mb-2">글씨 크기</p>
            <div className="flex gap-2">
              {([
                { value: "normal", label: "작게",   size: "text-xs"  },
                { value: "large",  label: "기본",   size: "text-sm"  },
                { value: "xl",     label: "크게", size: "text-base" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFontSize(opt.value as FontSize)}
                  className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-all ${
                    fontSize === opt.value
                      ? "border-accent-blue bg-accent-blue/10"
                      : "border-border hover:border-accent-blue/40 hover:bg-bg-elevated"
                  }`}
                >
                  <span className={`font-bold text-text-primary ${opt.size}`}>Aa</span>
                  <span className="text-[10px] text-text-muted">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 화면 방향 */}
          <div>
            <p className="text-xs font-semibold text-text-muted mb-2">화면 방향</p>
            <p className="text-2xs text-text-dim mb-2">설치된 앱(PWA) 등 일부 환경에서만 적용돼요</p>
            <div className="flex gap-2">
              {([
                { value: "landscape", label: "가로",     icon: RectangleHorizontal },
                { value: "portrait",  label: "세로",     icon: RectangleVertical   },
                { value: "system",    label: "시스템설정", icon: Smartphone          },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => {
                    setOrientation(opt.value as Orientation);
                    /* 화면 회전 고정 API는 사용자 클릭(transient activation) 직후
                       동기적으로 호출해야 동작하는 브라우저가 있어 useEffect가 아닌
                       클릭 핸들러에서 직접 호출 */
                    const so = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
                    if (!so) return;
                    /* lock()/unlock()은 풀스크린/PWA가 아닌 일반 브라우저 탭에서
                       Promise reject가 아니라 동기적으로 예외를 던지는 환경이 있어
                       try/catch로 감싸야 함 (안 그러면 앱 전체가 흰/검은 화면으로 죽음) */
                    try {
                      if (opt.value === "system") so.unlock?.();
                      else so.lock?.(opt.value)?.catch(() => {});
                    } catch {}
                  }}
                  className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-all ${
                    orientation === opt.value
                      ? "border-accent-blue bg-accent-blue/10"
                      : "border-border hover:border-accent-blue/40 hover:bg-bg-elevated"
                  }`}
                >
                  <opt.icon size={16} className="text-text-primary" />
                  <span className="text-[10px] text-text-muted">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 알림 — 로그인한 사람에게만 의미가 있다 */}
          {isLoggedIn && (
            <div>
              <p className="text-xs font-semibold text-text-muted mb-2">알림</p>
              <p className="text-2xs text-text-dim mb-2">끈 알림은 아예 쌓이지 않아요</p>
              <div className="border border-border rounded-xl overflow-hidden">
                <NotificationToggles />
              </div>
            </div>
          )}

</div>
        <div className="px-5 pb-5 pt-4 border-t border-border shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2 text-sm font-semibold rounded-lg bg-accent-blue text-white hover:bg-blue-600 transition-colors"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
