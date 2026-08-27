import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { API미리연결 } from "./src/utils/apiPreconnect";

function api미리연결플러그인(mode: string): Plugin {
  return {
    name: "api-preconnect",
    transformIndexHtml(html) {
      const env = loadEnv(mode, process.cwd(), "VITE_");
      const 태그 = API미리연결(env.VITE_API_URL);
      if (!태그) return html;
      return html.replace("</head>", `    ${태그}\n  </head>`);
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), api미리연결플러그인(mode)],
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
    rollupOptions: {
      output: {
        /* 묶음을 이름표(배열)가 아니라 파일 경로로 가른다.

           배열 방식 `{ "chart-recharts": ["recharts"] }` 은 rollup 이
           recharts 에서 도달 가능한 것을 전부 그 청크로 끌어간다. 그래서
           clsx 처럼 여기저기서 쓰는 작은 유틸이 409KB 짜리 차트 묶음
           안으로 들어갔고, 공용 ui 청크가 그걸 가져오느라
           `import "./chart-recharts.js"` 를 달게 됐다.

           결과: 피드는 차트를 한 장도 안 그리는데 recharts 409KB 를 받아야
           모듈 본문이 실행됐다. lazy 로 바꿔도, preload 링크를 지워도
           소용없었다 — 그건 받는 시점만 늦출 뿐 받는 사실은 그대로다.
           (오히려 병렬 다운로드가 직렬이 돼 더 늦어졌다)

           경로로 가르면 그 패키지 파일만 들어간다. d3 는 recharts 전용이라
           같이 둔다. */
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          /* 여러 곳이 함께 쓰는 작은 유틸을 먼저 빼낸다.
             recharts 가 clsx 를 의존하는 탓에, 안 빼면 clsx 가 409KB
             차트 묶음 안으로 들어간다. 그러면 clsx 를 쓰는 공용 ui 청크가
             차트 묶음을 import 하게 되고, 결국 모든 화면이 recharts 를
             받는다 — 차트를 한 장도 안 그리는 피드까지. */
          if (/[\\/]node_modules[\\/](clsx|tailwind-merge|class-variance-authority)[\\/]/.test(id))
            return "vendor-util";
          if (/[\\/]node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor|decimal\.js[^\\/]*)[\\/]/.test(id))
            return "chart-recharts";
          if (/[\\/]node_modules[\\/]lightweight-charts[\\/]/.test(id)) return "chart-lw";
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id))
            return "vendor-react";
          if (/[\\/]node_modules[\\/]@tanstack[\\/]/.test(id)) return "vendor-query";
          if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return "vendor-lucide";
        },
      },
    },
  },
}));
