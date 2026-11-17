import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "admin-login-route",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === "/admin/login" || req.url === "/admin/login/") {
            req.url = "/admin/login/index.html";
          }
          next();
        });
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": "http://127.0.0.1:4100",
      "/demo": "http://127.0.0.1:4100",
      "/mcp": "http://127.0.0.1:4100",
    },
    fs: {
      deny: [
        ".env",
        ".env.*",
        "**/.git/**",
        "**/data/**",
        "**/scripts/**",
        "**/server/**",
      ],
    },
  },
  build: {
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      input: {
        home: resolve("index.html"),
        adminLogin: resolve("admin/login/index.html"),
        inspector: resolve("inspector.html"),
      },
      output: {
        manualChunks: (id) =>
          id.includes("/node_modules/three/") ? "three" : undefined,
      },
    },
  },
});
