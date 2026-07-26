import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    // 화면 동작 테스트를 위해 브라우저 DOM을 흉내내는 환경을 쓴다
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // 빌드 산출물·의존성은 검사 대상에서 제외
    exclude: ["node_modules/**", "dist/**"],
  },
});
