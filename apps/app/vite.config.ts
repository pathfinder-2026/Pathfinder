import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Production web app. Runs on :5174 (the preview console keeps :5173) and proxies
 * /api to the Fastify server on :3000 (same-origin -> no CORS).
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api": { target: "http://127.0.0.1:3000", changeOrigin: true },
    },
  },
});
