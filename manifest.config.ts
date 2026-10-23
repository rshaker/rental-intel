import "./tasks/extension-site-origin.js";
import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };
import { ALL_SOURCES, allHosts } from "./src/sources/descriptors.js";

/**
 * MV3 manifest. CRXJS rewrites the source paths below to the hashed build
 * output. Hosts are optional: a source is off until enabled on the Sources
 * tab, so there are no `content_scripts` here. E2E=1 builds the test variant:
 * every host required, since Playwright cannot click through Chrome's
 * permission prompt, and the example source at its dev server.
 */
export const E2E = process.env["E2E"] === "1";

const hosts = allHosts(ALL_SOURCES);

export default defineManifest({
    manifest_version: 3,
    name: E2E ? "Rental Intel (test build)" : "Rental Intel",
    version: pkg.version,
    description: pkg.description,

    // Uint8Array.toBase64 / fromBase64 (the backup format) landed in 140.
    minimum_chrome_version: "140",

    icons: {
        16: "src/icons/icon-16.png",
        32: "src/icons/icon-32.png",
        48: "src/icons/icon-48.png",
        128: "src/icons/icon-128.png",
    },

    action: {
        // No `default_popup`: the click shows or hides the side panel (background.ts).
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

    permissions: [
        "contextMenus",
        "scripting",
        "sidePanel",
        // The panel reads the active tab's address to tell a supported site from the rest, before any host is granted.
        "tabs",
        "unlimitedStorage",
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
