import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 前端为 React + antd 单页应用; 产物输出到 dist/web, 由本地 TS 代理服务器以纯静态方式托管
export default defineConfig({
  root: "src/web",
  base: "/",
  plugins: [react()],
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    assetsDir: "assets",
    chunkSizeWarningLimit: 2500,
  },
});