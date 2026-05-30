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
        "2xs": ["10px", "14px"],
        xs:    ["11px", "16px"],
        sm:    ["12px", "18px"],
        base:  ["13px", "20px"],
        md:    ["14px", "22px"],
        lg:    ["16px", "24px"],
        xl:    ["18px", "28px"],
        "2xl": ["22px", "32px"],
        "3xl": ["28px", "36px"],
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
