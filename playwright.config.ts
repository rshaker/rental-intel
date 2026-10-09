import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests drive a real Chrome with the unpacked extension loaded, so
 * they need a build first: `npm run playwright:test` does an E2E build
 * (`E2E=1`, see manifest.config.ts) and then runs this.
 *
 * Extensions only work in a persistent context, which the fixture in
 * playwright/harness/extension.ts sets up.
 */
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
