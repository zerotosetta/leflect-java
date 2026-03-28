import { defineConfig } from "vite";

const dashboardApiOrigin = process.env.LEFLECT_DASHBOARD_API_ORIGIN ?? "http://127.0.0.1:3000";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
    proxy: {
      "/api": {
        target: dashboardApiOrigin,
        changeOrigin: true
      }
    }
  }
});
