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
        "2xs": ["0.625rem",  "0.875rem"],
        xs:    ["0.6875rem", "1rem"],
        sm:    ["0.75rem",   "1.125rem"],
        base:  ["0.8125rem", "1.25rem"],
        md:    ["0.875rem",  "1.375rem"],
        lg:    ["1rem",      "1.5rem"],
        xl:    ["1.125rem",  "1.75rem"],
        "2xl": ["1.375rem",  "2rem"],
        "3xl": ["1.75rem",   "2.25rem"],
      },
      borderRadius: {
        sm:  "6px", md: "10px", lg: "14px", xl: "18px", "2xl": "24px",
      },
      boxShadow: {
        card:         "0 2px 8px rgba(0,0,0,0.4)",
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
