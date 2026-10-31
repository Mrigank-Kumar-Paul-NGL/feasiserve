import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Live checks hit real TinyFish + Supabase; never part of `npm test`.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: { environment: "node", include: ["tests/live/**/*.live.ts"] },
});
