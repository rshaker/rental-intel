import { defineConfig } from "vitest/config";

/** Separate from vite.config.ts, which loads the CRXJS plugin. */
export default defineConfig({
    define: {
        // The fixtures are written for the dev server, whatever the environment says.
        __SITE_ORIGIN__: JSON.stringify("http://localhost:5174"),
    },
    test: {
        environment: "jsdom",
        include: ["src/**/*.test.ts", "site/**/*.test.ts"],
    },
});
