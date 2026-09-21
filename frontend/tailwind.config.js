/** CSS 변수로 된 색에 투명도(/50)가 먹게 한다.
 *
 * 색 토큰이 "var(--bg-card)" 같은 글자였다. Tailwind 는 그런 색에
 * `/50` 을 붙이면 투명도를 못 넣고 그 규칙을 통째로 버린다 — 오류도
 * 경고도 없다. 그래서 지금까지
 *
 *   border-border/50  →  테두리가 Tailwind 기본색(밝은 회색)으로 나옴
 *   text-text-muted/40 →  투명도가 안 먹고 물려받은 색 그대로
 *
 * 이 됐다. 어두운 화면에 흐릿해야 할 구분선이 밝은 회색 줄로
 * 그어지고 있었던 것이다(가격 알림 화면을 찍어 보고 알았다).
 * 지금 코드에 그런 자리가 113곳이다.
 *
 * 투명도를 안 쓸 때는 예전과 글자 하나 다르지 않게 var(...) 를
 * 그대로 돌려준다 — 바꾸는 것은 '지금 깨져 있는 자리' 뿐이다.
 */
const 변수색 = (이름) => ({ opacityValue } = {}) => {
  // 투명도 없이 쓰면 예전 그대로
  if (opacityValue === undefined || String(opacityValue).startsWith("var(")) {
    return `var(${이름})`;
  }
  const 비율 = Number(opacityValue) * 100;
  return `color-mix(in srgb, var(${이름}) ${비율}%, transparent)`;
};

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          base:      변수색("--bg-base"),
          primary:   변수색("--bg-primary"),
          secondary: 변수색("--bg-secondary"),
          card:      변수색("--bg-card"),
          elevated:  변수색("--bg-elevated"),
          hover:     변수색("--bg-hover"),
        },
        border: {
          DEFAULT: 변수색("--border-default"),
          light:   변수색("--border-light"),
          subtle:  변수색("--border-subtle"),
        },
        text: {
          primary:   변수색("--text-primary"),
          secondary: 변수색("--text-secondary"),
          muted:     변수색("--text-muted"),
          dim:       변수색("--text-dim"),
        },
        accent: {
          blue:   "#3b82f6",
          green:  "#10b981",
          red:    "#ef4444",
          yellow: "#f59e0b",
          purple: "#8b5cf6",
          cyan:   "#06b6d4",
          orange: "#f97316",
          /* amber 는 이 목록에 없었는데 화면 25곳이 이미 쓰고 있었다.
             Tailwind 는 없는 이름을 조용히 버린다 — 오류도 경고도 없이
             그 자리가 색 없는 글자가 된다. 그래서 실시간 배지의 점,
             퀀트 화면의 주의 상자, 관리자 화면의 경고 문구가 전부
             '평범한 회색 글자' 로 나오고 있었다(무엇도 안 깨져 보여서
             더 오래 갔다).
             값은 노랑과 같은 #f59e0b 다 — 쓰는 쪽이 원래 그 색을
             뜻했다. 아래 DesignTokens 검사가 없는 이름을 잡는다. */
          amber:  "#f59e0b",
        },
      },
      fontFamily: {
        mono:  ["JetBrains Mono", "Fira Code", "monospace"],
        sans:  ["Pretendard Variable", "Pretendard", "system-ui", "sans-serif"],
      },
      fontSize: {
        // rem 단위 — 글씨크기 설정(html.font-large/xl의 루트 font-size 변경)에
        // 비례해서 커지도록 px 대신 rem 을 쓴다.
        //
        // ── 아래 px 는 **root 14px 기준** 이다 ──
        //
        // 예전에는 '16px 기준 환산' 이라고 적혀 있었는데 실제 root 는
        // 14px 이다(index.css). 그래서 주석이 말하는 크기와 화면에
        // 그려지는 크기가 12.5% 어긋나 있었다 — '작은 쪽만 1px 올려
        // 10→11px' 이라고 적어 두고 실제로는 9.6px 를 만든 셈이다.
        //
        // 표를 실제 값으로 바로잡는다. 값 자체는 안 건드린다 — 지금
        // 화면이 이 크기로 맞춰져 있고, 여기를 흔들면 앱 전체가 흔들린다.
        //
        //   normal(14px)  large(16px)  xl(18px)  ← 설정의 글씨 크기
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
        //   1) 작은 쪽만 한 눈금 올린다. 제일 작은 라벨이 휴대폰에서
        //      읽기 힘들었다. 여기가 전체의 91% 라 조금만 올려도
        //      화면 전체가 편해진다.
        //   2) lg(16px) 이상은 손대지 않는다. 제목이 커져서 어색했던
        //      게 바로 이쪽이었다.
        //
        // 이름을 안 바꿨으므로 화면 코드를 한 줄도 안 고쳐도 반영된다.
        "2xs": ["0.6875rem", "0.9375rem"],  //  9.6 / 11.0 / 12.4 px  가장 작은 라벨
        xs:    ["0.75rem", "1.0625rem"],  //  10.5 / 12.0 / 13.5 px  부가정보
        sm:    ["0.8125rem", "1.1875rem"],  //  11.4 / 13.0 / 14.6 px
        base:  ["0.875rem", "1.3125rem"],  //  12.2 / 14.0 / 15.8 px  본문·종목명
        md:    ["0.9375rem", "1.4375rem"],  //  13.1 / 15.0 / 16.9 px
        lg:    ["1rem", "1.5rem"],  //  14.0 / 16.0 / 18.0 px
        xl:    ["1.125rem", "1.75rem"],  //  15.8 / 18.0 / 20.2 px
        "2xl": ["1.375rem", "2rem"],  //  19.2 / 22.0 / 24.8 px
        "3xl": ["1.75rem", "2.25rem"],  //  24.5 / 28.0 / 31.5 px

        // ── 숫자 전용 ──────────────────────────────────────
        //
        // 자산 앱의 정체성은 '숫자가 크다' 는 것인데 그 크기가 아예
        // 없었다. 총자산·지수 값처럼 화면에 하나뿐인 숫자에만 쓴다 —
        // 여기저기 쓰면 위에서 되돌린 일이 되풀이된다.
        display: ["1.5rem", "1.875rem"],  //  21.0 / 24.0 / 27.0 px  가격·수익률
        hero:  ["1.875rem", "2.25rem"],  //  26.3 / 30.0 / 33.8 px  총자산·지수
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
