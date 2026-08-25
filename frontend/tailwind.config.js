/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          base:      "var(--bg-base)",
          primary:   "var(--bg-primary)",
          secondary: "var(--bg-secondary)",
          card:      "var(--bg-card)",
          elevated:  "var(--bg-elevated)",
          hover:     "var(--bg-hover)",
        },
        border: {
          DEFAULT: "var(--border-default)",
          light:   "var(--border-light)",
          subtle:  "var(--border-subtle)",
        },
        text: {
          primary:   "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted:     "var(--text-muted)",
          dim:       "var(--text-dim)",
        },
        accent: {
          blue:   "#3b82f6",
          green:  "#10b981",
          red:    "#ef4444",
          yellow: "#f59e0b",
          purple: "#8b5cf6",
          cyan:   "#06b6d4",
          orange: "#f97316",
        },
      },
      fontFamily: {
        mono:  ["JetBrains Mono", "Fira Code", "monospace"],
        sans:  ["Pretendard Variable", "Pretendard", "system-ui", "sans-serif"],
      },
      fontSize: {
        // rem 단위 — 글씨크기 설정(html.font-large/xl의 루트 font-size 변경)에 비례해서 커지도록 px 대신 rem 사용 (16px 기준 환산)
        //
        // ── 얼마나 키울 것인가 ────────────────────────────
        //
        // 한 번 너무 키웠다가 되돌렸다. 처음에는 아홉 단계를 통째로
        // 올리고 큰 쪽을 더 벌렸는데(2xl 22→28, 3xl 28→36), 화면이
        // 시원해지는 게 아니라 그냥 커져 버렸다. 정보를 촘촘히 보는
        // 화면이라 토스·뱅크샐러드처럼 여백이 넉넉한 앱의 큰 제목을
        // 그대로 가져오면 안 맞는다.
        //
        // 지금은 두 가지만 한다.
        //
        //   1) 작은 쪽만 1px 올린다(10·11·12·13·14 → 11·12·13·14·15).
        //      10px 는 휴대폰에서 읽기 힘들다. 여기가 전체의 91% 라
        //      1px 만 올려도 화면 전체가 편해진다.
        //   2) 16px 이상은 손대지 않는다. 제목이 커져서 어색했던 게
        //      바로 이쪽이었다.
        //
        // 이름을 안 바꿨으므로 화면 코드를 한 줄도 안 고쳐도 반영된다.
        "2xs": ["0.6875rem", "0.9375rem"],  // 10 → 11px  가장 작은 라벨
        xs:    ["0.75rem",   "1.0625rem"],  // 11 → 12px  부가정보
        sm:    ["0.8125rem", "1.1875rem"],  // 12 → 13px
        base:  ["0.875rem",  "1.3125rem"],  // 13 → 14px  본문·종목명
        md:    ["0.9375rem", "1.4375rem"],  // 14 → 15px
        lg:    ["1rem",      "1.5rem"],     // 16px  그대로
        xl:    ["1.125rem",  "1.75rem"],    // 18px  그대로
        "2xl": ["1.375rem",  "2rem"],       // 22px  그대로
        "3xl": ["1.75rem",   "2.25rem"],    // 28px  그대로

        // ── 숫자 전용 ──────────────────────────────────────
        //
        // 자산 앱의 정체성은 '숫자가 크다' 는 것인데 그 크기가 아예
        // 없었다. 총자산·지수 값처럼 화면에 하나뿐인 숫자에만 쓴다 —
        // 여기저기 쓰면 위에서 되돌린 일이 되풀이된다.
        display: ["1.5rem",   "1.875rem"],  // 24px  가격·수익률
        hero:    ["1.875rem", "2.25rem"],   // 30px  총자산·지수
      },
      borderRadius: {
        sm:  "6px", md: "10px", lg: "14px", xl: "18px", "2xl": "24px",
      },
      // 그림자는 '얼마나 떠 있는가' 세 층이면 충분하다.
      //
      // 토큰은 진작 있었는데 아무도 안 썼다(card·modal·glow 사용 0곳).
      // 대신 shadow-lg/2xl/xl/sm 이 흩어져 있었고, 같은 종류의 것이
      // 화면마다 다르게 떠 보였다. 실제 쓰임을 보니 세 층으로 갈렸다.
      boxShadow: {
        // 바닥에 붙어 있는 것 — 카드, 눌린 탭
        card:         "0 2px 8px rgba(0,0,0,0.4)",
        // 살짝 떠 있는 것 — 드롭다운, 토스트, 툴팁, 검색 제안
        float:        "0 8px 24px rgba(0,0,0,0.5)",
        // 화면을 덮는 것 — 모달, 아래에서 올라오는 시트
        modal:        "0 20px 60px rgba(0,0,0,0.6)",
        glow:         "0 0 20px rgba(59,130,246,0.15)",
        "glow-green": "0 0 20px rgba(16,185,129,0.15)",
      },
      animation: {
        "pulse-slow": "pulse 3s ease-in-out infinite",
        "fade-in":    "fadeIn 0.2s ease",
        "slide-up":   "slideUp 0.25s ease",
      },
    },
  },
  plugins: [],
};
