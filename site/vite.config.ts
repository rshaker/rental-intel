import "../tasks/site-origin.mjs";
import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listingsExampleSite } from "./plugin.js";
import { SITE_ORIGIN } from "../src/sources/example/origin.js";

/**
 * The invented rental site the example source reads. `npm run site:dev`
 * serves it at SITE_ORIGIN (http://localhost:5174 unless the environment
 * says otherwise; src/sources/example/origin.ts); `npm run site:build`
 * writes it to site/dist/, which the Playwright harness serves to the
 * extension at that same origin (playwright/harness/site.ts).
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(new URL(SITE_ORIGIN).port) || 5174;

export default defineConfig({
    root: HERE,
    publicDir: false,
    appType: "custom",
    plugins: [listingsExampleSite()],
    server: { port: PORT },
    preview: { port: PORT },
    build: {
        outDir: resolve(HERE, "dist"),
        emptyOutDir: true,
        reportCompressedSize: false,
        rollupOptions: { input: resolve(HERE, "src/entry.ts") },
    },
});
