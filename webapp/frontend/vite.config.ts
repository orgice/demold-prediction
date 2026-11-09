import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 개발 모드(npm run dev) 설정. Docker 없이 화면을 고치며 볼 때 쓴다.
// http://localhost:5173 에서 열리고, /api 요청은 백엔드(기본 localhost:8000)로 넘긴다.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": process.env.API_URL ?? "http://localhost:8000" },
  },
});
