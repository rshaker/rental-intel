import { defineConfig } from "vitest/config";

/** Separate from vite.config.ts, which loads the CRXJS plugin. `__E2E__` is true so the example source is in the registry under test. */
export default defineConfig({
    define: {
        __E2E__: "true",
        // The fixtures are written for the default origin, whatever the environment says.
        __SITE_ORIGIN__: JSON.stringify("http://localhost:5174"),
    },
    test: {
        environment: "jsdom",
        include: ["src/**/*.test.ts", "site/**/*.test.ts"],
    },
});
