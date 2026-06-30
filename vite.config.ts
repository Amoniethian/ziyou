import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",  // Relative paths so it works on GitHub Pages without subpath config
  build: {
    target: "es2020",
    // No source maps in production: don't ship near-original readable source
    // to the live site. (Minified bundles still run; just harder to read.)
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      // Split Three.js into its own chunk — it rarely changes, so browsers
      // can cache it across app updates.
      output: {
        manualChunks: { three: ["three"], supabase: ["@supabase/supabase-js"] }
      }
    }
  },
  server: { port: 5173, open: false }
});
