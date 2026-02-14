import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import cssInjectedByJs from "vite-plugin-css-injected-by-js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), cssInjectedByJs()],
  build: {
    outDir: path.join(__dirname, "..", "javascript"),
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, "src", "main.jsx"),
      name: "StyleGridUI",
      fileName: () => "style_grid_ui.js",
      formats: ["iife"],
    },
    rollupOptions: {
      output: {
        extend: true,
        inlineDynamicImports: true,
      },
      external: [],
    },
    minify: "esbuild",
    sourcemap: false,
  },
});
