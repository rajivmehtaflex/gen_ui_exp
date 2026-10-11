import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The browser never talks to OpenRouter directly — it talks to our tiny
// Express server. In dev, Vite forwards /api/* to it so the client code
// can just fetch("/api/chat") with no CORS and no absolute URLs.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: false,
      },
    },
  },
});
