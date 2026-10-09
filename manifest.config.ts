import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };
import { allHosts, sourceList } from "./src/sources/descriptors.js";

/**
 * MV3 manifest, typed. CRXJS rewrites the source paths below (`src/**`) to the
 * hashed build output, so entry points are referenced here by their real source
 * location -- do not point these at `dist`.
 *
 * The sites come from the source registry. Their hosts are optional: a source
 * is off until the user enables it on the panel's Sources tab, and its
 * content script is registered by the worker at that point (worker/sources.ts).
 * No `content_scripts` here, then, and no `host_permissions`.
 *
 * E2E=1 builds the test variant: the same sources plus the synthetic example
 * source, with every host *required* rather than optional. Playwright cannot
 * click through Chrome's permission prompt, and required hosts take the same
 * registration path once granted, so the difference is confined to this file.
 */
export const E2E = process.env["E2E"] === "1";

const hosts = allHosts(sourceList(E2E));

export default defineManifest({
    manifest_version: 3,
    name: E2E ? "Rental Intel (test build)" : "Rental Intel",
    version: pkg.version,
    description: pkg.description,

    // Uint8Array.toBase64 / fromBase64 (the backup format) landed in 140.
    // Everything else needed less: chrome.sidePanel.open() requires 116.
    minimum_chrome_version: "140",

    icons: {
        16: "src/icons/icon-16.png",
        32: "src/icons/icon-32.png",
        48: "src/icons/icon-48.png",
        128: "src/icons/icon-128.png",
    },

    action: {
        // The click shows or hides the side panel on this tab (background.ts),
        // so there is no `default_popup`: chrome.action.onClicked has to fire.
        // Enabled everywhere: the panel searches saved listings, which is
        // useful on any tab, not only on a listing site.
        default_title: "Show or hide Rental Intel",
        default_icon: {
            16: "src/icons/icon-16.png",
            32: "src/icons/icon-32.png",
            48: "src/icons/icon-48.png",
            128: "src/icons/icon-128.png",
        },
    },

    background: {
        service_worker: "src/background.ts",
        type: "module",
    },

    side_panel: {
        default_path: "src/panel/index.html",
    },

    // The standard preferences page, for "Extension options" on
    // chrome://extensions. It renders the same settings as the side panel's
    // Settings tab from the same table; a full tab suits a longer form better
    // than the embedded dialog would.
    options_ui: {
        page: "src/options/index.html",
        open_in_tab: true,
    },

    permissions: [
        "contextMenus", // "Show or hide Rental Intel" right-click entry
        "scripting", // registers each enabled source's content script
        "sidePanel",
        // No "storage": all persistence is IndexedDB (Dexie) plus the panel's
        // own localStorage, neither of which needs chrome.storage.
        "unlimitedStorage", // photo blobs in IndexedDB add up fast
    ],

    ...(E2E ? { host_permissions: hosts } : { optional_host_permissions: hosts }),

    commands: {
        "open-side-panel": {
            suggested_key: {
                default: "Ctrl+Shift+Y",
                mac: "Command+Shift+Y",
            },
            description: "Show or hide the Rental Intel side panel on this tab",
        },
    },
});
