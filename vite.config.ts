import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config.js";
import { E2E } from "./manifest.config.js";

// CRXJS handles extension-origin CORS and tunnels HMR over chrome.runtime ports
// itself, so `npm run dev` needs no extra server configuration here.
export default defineConfig({
    plugins: [crx({ manifest })],
    define: {
        // Whether this is a test build. See `E2E` in manifest.config.ts for what
        // it changes; src/sources/descriptors.ts reads this constant.
        __E2E__: JSON.stringify(E2E),
    },
    build: {
        // The test build lives beside the everyday one rather than over it: the
        // everyday Chrome loads dist/, Playwright loads dist-e2e/, and a test run
        // never leaves the test build (example source, required hosts) in the
        // directory Chrome has loaded.
        outDir: E2E ? "dist-e2e" : "dist",
        emptyOutDir: true,
        target: "esnext",
        // Maps ship with every local build (README, "Source maps"). The store
        // package is built with RELEASE=1 by `npm run zip`, which drops them --
        // otherwise CRXJS lists the .map files in web_accessible_resources even
        // though the zip step leaves them out.
        sourcemap: !process.env.RELEASE,
        // Emit every asset as a real file. Vite would otherwise inline anything
        // under 4 kB as a data: URI, which breaks the two things extensions need
        // most from assets: chrome.action.setIcon({ path }) cannot load a data
        // URI, and inlined assets run into the extension CSP.
        assetsInlineLimit: 0,
        // Pages the manifest does not name still need to be built. CRXJS adds
        // the manifest's own entries to this list.
        rollupOptions: {
            input: { viewer: "src/viewer/index.html" },
        },
    },
    server: {
        // Preferred port, not a required one. strictPort would turn a dev server
        // left running from an earlier session into a hard launch failure, and
        // nothing outside the extension references this port -- CRXJS writes the
        // resolved one into dist/ as it starts.
        port: 5173,
    },
});
