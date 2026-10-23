import { defineConfig, devices } from "@playwright/test";

/**
 * The README's usage screenshots, not tests. Loads the test build and the
 * built site like the suite does, and the release build for the Sources
 * tab, and writes PNG files to docs/images/usage/. `npm run readme:images`
 * builds everything and runs it.
 */
export default defineConfig({
    testDir: ".",
    testMatch: "usage.spec.ts",
    workers: 1,
    retries: 0,
    timeout: 480_000,
    reporter: [["list"]],
    outputDir: "../../work/readme/test-results",
    use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1200, height: 800 },
    },
});
