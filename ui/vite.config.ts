import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const port = Number(process.env.UI_PORT ?? 5173);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port,
    // The API allows exactly one browser origin. Drifting to the next free
    // port would silently fail every request with a CORS error instead of
    // saying the port is taken, so refuse to start rather than move.
    strictPort: true,
    // Dev behaves like production: the browser only ever talks to this
    // origin, and /api is forwarded to the agent process.
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:8787",
        changeOrigin: false,
      },
    },
  },
});
