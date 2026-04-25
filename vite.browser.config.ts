import { defineConfig } from "vite";

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    minify: false,
    outDir: "dist/browser",
    sourcemap: true,
    target: "es2022",
    lib: {
      entry: "src/browser/index.ts",
      fileName: () => "index.js",
      formats: ["es"]
    },
    rollupOptions: {
      output: {
        sourcemapExcludeSources: false
      }
    }
  }
});
