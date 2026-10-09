import { defineConfig } from "vitest/config";

/** Separate from vite.config.ts, which loads the CRXJS plugin. `__E2E__` is true so the example source is in the registry under test. */
export default defineConfig({
    define: {
        __E2E__: "true",
    },
    test: {
        environment: "jsdom",
        include: ["src/**/*.test.ts"],
    },
});
