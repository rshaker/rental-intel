import { defineConfig, devices } from "@playwright/test";

/**
 * The upgrade from the previous release: one spec that writes a database
 * with the previous release's build and reads it with this one. Needs
 * work/previous/dist-e2e (tasks/build-previous.mjs) and dist-e2e;
 * `npm run playwright:upgrade` makes both and runs it.
 */
export default defineConfig({
    testDir: ".",
    testMatch: "upgrade.spec.ts",
    workers: 1,
    retries: 0,
    timeout: 120_000,
    reporter: [["list"]],
    outputDir: "../test-results-upgrade",
    use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1200, height: 800 },
        trace: "retain-on-failure",
    },
});
