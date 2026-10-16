import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config.js";
import { E2E } from "./manifest.config.js";
import { DEFAULT_SITE_ORIGIN } from "./src/sources/example/origin.js";

export default defineConfig({
    plugins: [crx({ manifest })],
    define: {
        // Whether this is a test build; see manifest.config.ts.
        __E2E__: JSON.stringify(E2E),
        // Where the example site lives; see src/sources/example/origin.ts.
        __SITE_ORIGIN__: JSON.stringify(process.env["SITE_ORIGIN"] || DEFAULT_SITE_ORIGIN),
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
