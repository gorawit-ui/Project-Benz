import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Teaches Vitest the same `@/` path alias tsconfig gives the app, so a test
 * can import a module that itself imports `@/lib/...`. Until now every test
 * lived in lib/ and used relative imports, so nothing needed it; testing a
 * helper exported from a component does.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
