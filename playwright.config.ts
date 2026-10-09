import { defineConfig, devices } from "@playwright/test";

/** The browser suite drives a real Chrome with the test build (dist-e2e/) loaded; `npm run playwright:test` builds it first. */
export default defineConfig({
    testDir: "playwright/specs",
    fullyParallel: false,
    workers: 1, // one browser profile, one worker
    forbidOnly: !!process.env["CI"],
    retries: process.env["CI"] ? 2 : 0,
    reporter: [
        ["list"],
        ["html", { open: "never", outputFolder: "playwright/playwright-report" }],
    ],
    outputDir: "playwright/test-results",
    use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1200, height: 800 },
        trace: "retain-on-failure",
    },
});
