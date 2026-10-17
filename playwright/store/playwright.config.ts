import { defineConfig, devices } from "@playwright/test";

/**
 * Store-listing screenshots, not tests. Loads the test build and the built
 * site like the suite does and writes PNG/JPEG files to work/store/.
 * `npm run store:artwork` builds both and runs it.
 */
export default defineConfig({
    testDir: ".",
    testMatch: "screenshots.spec.ts",
    workers: 1,
    retries: 0,
    timeout: 480_000,
    reporter: [["list"]],
    outputDir: "../../work/store/test-results",
    use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1200, height: 800 },
    },
});
