import { defineConfig } from "vitest/config";

/**
 * Separate from vite.config.ts on purpose: that one loads crx({ manifest }),
 * which wants to build a whole extension and has no business running during unit
 * tests. Nothing here needs a plugin -- the code under test is plain TypeScript
 * with a Document passed in.
 *
 * `__E2E__` is true so the example source (src/sources/example/) is in the
 * registry under test, as it is in the Playwright build.
 */
export default defineConfig({
    define: {
        __E2E__: "true",
    },
    test: {
        environment: "jsdom",
        include: ["src/**/*.test.ts"],
    },
});
