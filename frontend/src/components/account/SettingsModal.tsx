/**
 * 설정 창.
 *
 * 예전에는 Layout 안에 들어 있었다. 더보기가 화면으로 나오면서 설정을 여는
 * 자리가 두 곳(사이드바, 더보기 화면)이 됐고, 둘 다 이걸 써야 해서 뺐다.
 */
import { Sun, Moon, Monitor, X, RectangleHorizontal, RectangleVertical, Smartphone, Eye, EyeOff } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useSettingsStore } from "@/store/settingsStore";
import type { ColorScheme, FontSize, Theme, Orientation } from "@/store/settingsStore";
import { NotificationToggles } from "@/components/community/NotificationSettings";
import { 원하는방향, 지원 as 방향고정지원, use고정상태, 방향안내 } from "@/utils/화면방향";

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const { colorScheme, setColorScheme, fontSize, setFontSize, theme, setTheme, orientation, setOrientation,
          금액가리기, set금액가리기,
          불러오기표시, set불러오기표시 } = useSettingsStore();
  const 고정상태 = use고정상태((s) => s.상태);
  const 전체화면으로고정 = use고정상태((s) => s.전체화면);
  const 방향지원 = 방향고정지원();
  // 고정할 수 없는 기기(아이폰·PC)에서는 골라 둔 값이 있어도 시스템설정으로 보인다 — 실제로 그렇게 돈다
  const 보이는방향: Orientation = 방향지원 === "된다" ? orientation : "system";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70 backdrop-blur-sm modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm max-h-[85vh] flex flex-col bg-bg-card border border-border rounded-2xl shadow-modal overflow-hidden modal-pop">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h3 className="text-sm font-bold text-text-primary">설정</h3>
          <button onClick={onClose} aria-label="닫기" className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated">
            <X size={14} />
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
                  <span className="text-2xs text-text-muted whitespace-nowrap">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 화면 모양('기본' · '앱처럼') 고르기는 없앴다 — 늘 '앱처럼'(큰 가격 → 차트 → 통계).
              사용자: "설정에서 앱처럼을 기본으로 해주고 기본설정은 완전히 없애줘" */}

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
                  <span className="text-2xs text-text-muted text-center leading-tight">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 글씨 크기 */}
          <div>
            <p className="text-xs font-semibold text-text-muted mb-2">글씨 크기</p>
            <div className="flex gap-2">
              {/* 라벨과 실제가 어긋나 있었다 — '작게' 로 적힌 것이 사실
                  기본값(14px)이고 '기본' 을 고르면 14% 커졌다. 이름을
                  믿고 '기본' 을 고른 사람은 자기도 모르게 키운 셈이다.
                  이름을 실제에 맞추고, 진짜로 더 작은 칸을 새로 둔다 */}
              {([
                { value: "small",  label: "작게",     size: "text-2xs" },
                { value: "normal", label: "보통",     size: "text-xs"  },
                { value: "large",  label: "크게",     size: "text-sm"  },
                { value: "xl",     label: "아주 크게", size: "text-base" },
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
                  <span className="text-2xs text-text-muted whitespace-nowrap">{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 화면 방향 — 어디서 되고 어디서 안 되는지(안드로이드는 전체 화면에서만, 아이폰은 안 됨)는
              utils/화면방향 맨 위 설명. 예전에는 안 되는 곳에서도 눌리기만 하고 아무 말이 없었다 */}
          <div>
            <p className="text-xs font-semibold text-text-muted mb-2">화면 방향</p>
            <div className="flex gap-2">
              {([
                { value: "landscape", label: "가로",     icon: RectangleHorizontal },
                { value: "portrait",  label: "세로",     icon: RectangleVertical   },
                { value: "system",    label: "시스템설정", icon: Smartphone          },
              ] as const).map((opt) => {
                const 고름 = 보이는방향 === opt.value;
                const 못고름 = opt.value !== "system" && 방향지원 !== "된다";
                return (
                  <button
                    key={opt.value}
                    disabled={못고름}
                    aria-pressed={고름}
                    onClick={() => {
                      setOrientation(opt.value as Orientation);
                      /* 누른 그 손으로 건다 — 안드로이드는 전체 화면에 들어가야 고정되는데, 전체 화면은
                         사람이 누른 그때만 들어갈 수 있다. 같은 것을 다시 눌러도(못 걸었을 때) 다시 건다 */
                      void 원하는방향(opt.value as Orientation);
                    }}
                    className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border transition-all ${
                      고름 ? "border-accent-blue bg-accent-blue/10"
                        : 못고름 ? "border-border opacity-40 cursor-not-allowed"
                        : "border-border hover:border-accent-blue/40 hover:bg-bg-elevated"
                    }`}
                  >
                    <opt.icon size={16} className="text-text-primary" />
                    <span className="text-2xs text-text-muted whitespace-nowrap">{opt.label}</span>
                  </button>
                );
              })}
            </div>
            <p role="status" className="text-2xs text-text-dim mt-1.5 break-keep">
              {방향안내(방향지원, orientation, 고정상태, 전체화면으로고정)}
            </p>
          </div>

          {/* 금액 가리기 —
              내 자산 화면 오른쪽 위 눈 버튼과 같은 설정이다. 두 곳에 둔
              이유는, 급할 때는 화면에서 바로 눌러야 하고(지하철), 평소에
              늘 가려 두고 싶은 사람은 여기서 한 번 켜 두면 되기 때문이다. */}
          <div>
            <p className="text-xs font-semibold text-text-muted mb-2">금액 가리기</p>
            <button
              onClick={() => set금액가리기(!금액가리기)}
              role="switch"
              aria-checked={금액가리기}
              className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                금액가리기 ? "border-accent-blue bg-accent-blue/10" : "border-border hover:border-accent-blue/40 hover:bg-bg-elevated"
              }`}
            >
              {금액가리기 ? <EyeOff size={16} className="text-accent-blue shrink-0" />
                          : <Eye size={16} className="text-text-muted shrink-0" />}
              <span className="flex flex-col min-w-0 flex-1">
                <span className="text-xs font-semibold text-text-primary">
                  {금액가리기 ? "가리는 중" : "금액 보이기"}
                </span>
                <span className="text-2xs text-text-muted break-keep">
                  평가금액·손익·배당금을 ••••• 로 가려요. 수익률과 비중은 그대로 보여요
                </span>
              </span>
              <span className={`w-9 h-5 rounded-full shrink-0 transition-colors relative ${
                금액가리기 ? "bg-accent-blue" : "bg-bg-elevated border border-border"
              }`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                  금액가리기 ? "left-[1.125rem]" : "left-0.5"
                }`} />
              </span>
            </button>
          </div>

          {/* 불러오기 표시 — 오른쪽 아래 '데이터 불러오는 중' 팝업 */}
          <div>
            <p className="text-xs font-semibold text-text-muted mb-2">불러오기 표시</p>
            <div className="flex gap-2" role="radiogroup" aria-label="불러오기 표시">
              {([
                { value: "보이기", label: "보이기", desc: "불러오는 과정을 항목별로" },
                { value: "실패만", label: "실패만", desc: "못 불러왔을 때만" },
                { value: "끄기",   label: "끄기",   desc: "띄우지 않음" },
              ] as const).map((opt) => (
                <button
                  key={opt.value}
                  role="radio"
                  aria-checked={불러오기표시 === opt.value}
                  onClick={() => set불러오기표시(opt.value)}
                  className={`flex-1 flex flex-col items-center gap-0.5 p-2.5 rounded-xl border transition-all ${
                    불러오기표시 === opt.value
                      ? "border-accent-blue bg-accent-blue/10"
                      : "border-border hover:border-accent-blue/40 hover:bg-bg-elevated"
                  }`}
                >
                  <span className="text-xs font-semibold text-text-primary">{opt.label}</span>
                  <span className="text-2xs text-text-muted text-center leading-tight break-keep">{opt.desc}</span>
                </button>
              ))}
            </div>
            <p className="text-2xs text-text-dim mt-1.5 break-keep">
              화면 오른쪽 아래 '데이터 불러오는 중' 창이에요. 꺼도 데이터는 똑같이 불러와요.
            </p>
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
            className="w-full py-2 text-sm font-semibold rounded-lg bg-accent-blue text-white hover:bg-accent-blue transition-colors"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
