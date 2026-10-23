import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config.js";
import { E2E } from "./manifest.config.js";
import { extensionSiteOrigin } from "./src/sources/example/siteOrigins.js";

export default defineConfig({
    plugins: [crx({ manifest })],
    define: {
        // Where the example site lives: the published copy for a release, the dev server for the test build; see src/sources/example/siteOrigins.ts.
        __SITE_ORIGIN__: JSON.stringify(extensionSiteOrigin(process.env)),
    },
    build: {
        // The everyday Chrome loads dist/; Playwright loads dist-e2e/.
        outDir: E2E ? "dist-e2e" : "dist",
        emptyOutDir: true,
        target: "esnext",
        // The store package (`npm run zip`, RELEASE=1) ships without maps.
        sourcemap: !process.env.RELEASE,
        // Real files, not data: URIs: setIcon cannot load a data URI, and the extension CSP blocks inlining.
        assetsInlineLimit: 0,
        // Pages the manifest does not name.
        rollupOptions: {
            input: { viewer: "src/viewer/index.html" },
        },
    },
    server: {
        port: 5173,
    },
});
