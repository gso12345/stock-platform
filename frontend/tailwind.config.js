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
        // ── 왜 전부 키웠나 ────────────────────────────────
        //
        // 세어 보니 화면에 있는 글자 1,215곳 중 1,108곳(91.2%)이 12px
        // 이하였다. 16px 넘는 것은 40곳(3.3%), 28px 은 딱 한 곳.
        //
        // 크기가 다 같으면 '무엇이 중요한지' 를 눈이 못 알아챈다. 그래서
        // 대신 테두리와 상자로 구분하려 들고, 화면이 시끄러워진다.
        // 자산 앱(토스·뱅크샐러드)이 조용해 보이는 이유는 반대다 —
        // 총자산은 34px, 라벨은 12px 로 대비를 크게 벌려 놓는다.
        //
        // 아래는 두 가지를 한다.
        //   1) 기존 아홉 단계를 한 칸씩 올린다. 이름을 안 바꾸므로
        //      화면 코드를 한 줄도 안 고쳐도 전부 반영된다.
        //   2) 큰 쪽을 더 크게 벌린다(2xl 22→28, 3xl 28→36).
        //      대비가 커져야 위계가 생긴다.
        "2xs": ["0.6875rem", "0.9375rem"],  // 10 → 11px  가장 작은 라벨
        xs:    ["0.75rem",   "1.0625rem"],  // 11 → 12px  부가정보
        sm:    ["0.8125rem", "1.1875rem"],  // 12 → 13px
        base:  ["0.9375rem", "1.375rem"],   // 13 → 15px  본문·종목명
        md:    ["1rem",      "1.5rem"],     // 14 → 16px
        lg:    ["1.125rem",  "1.625rem"],   // 16 → 18px  섹션 제목
        xl:    ["1.375rem",  "1.875rem"],   // 18 → 22px
        "2xl": ["1.75rem",   "2.125rem"],   // 22 → 28px  화면 제목
        "3xl": ["2.25rem",   "2.625rem"],   // 28 → 36px

        // ── 숫자 전용 ──────────────────────────────────────
        //
        // 자산 앱의 정체성은 '숫자가 크다' 는 것인데 그 크기가 아예
        // 없었다. 총자산·지수 값·가격에 쓴다.
        display: ["1.75rem",  "2.125rem"],  // 28px  가격·수익률
        hero:    ["2.25rem",  "2.625rem"],  // 36px  총자산·지수
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
