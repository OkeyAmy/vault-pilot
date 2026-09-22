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
  },
});
