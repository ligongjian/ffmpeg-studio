import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Tauri expects a fixed port for the dev server
export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: false,
    hmr: { protocol: "ws", host: "localhost", port: 5173 },
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
