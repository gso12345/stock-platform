import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      "/ws":  { target: "http://localhost:8000", changeOrigin: true, ws: true },
    },
  },
  build: {
    /* 무거운 차트 묶음은 미리 받지 않는다.
       vite 는 lazy import 대상도 부모 청크의 modulepreload 목록에 넣는다.
       그래서 피드에서 PortfolioChart 를 lazy 로 바꿔도 recharts(gzip 110KB)
       가 계속 따라왔다 — 피드가 받는 707KB 중 400KB 가 그것이었고, 정작
       그 그림은 '포트폴리오를 공유한 글' 에만 나온다.

       preload 에서 빼도 정말 필요한 화면(대시보드·내 자산·퀀트)은 정적
       import 로 그대로 받는다. 링크 하나가 없어질 뿐이다.

       lightweight-charts(chart-lw)는 안 뺀다 — 종목상세는 차트가 주인공이라
       거기서는 미리 받는 편이 맞다. */
    modulePreload: {
      resolveDependencies: (_f: string, deps: string[]) =>
        deps.filter((d) => !d.includes("chart-recharts")),
    },
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react":    ["react", "react-dom", "react-router-dom"],
          "vendor-query":    ["@tanstack/react-query"],
          "chart-lw":        ["lightweight-charts"],
          "chart-recharts":  ["recharts"],
          "vendor-lucide":   ["lucide-react"],
        },
      },
    },
  },
});
