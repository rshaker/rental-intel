import { h, render } from "preact";
import { getSettings } from "../db/settings";
import { installDataDebugHandle } from "../lib/debug.data";
import { SettingsPane } from "../panel/components/SettingsPane";
import { publishScale } from "../panel/scale";

/**
 * The extension's options page (`options_ui` in the manifest): what Chrome
 * opens from "Extension options" and what chrome.runtime.openOptionsPage()
 * shows. It is the side panel's Options tab on its own page, backed by the
 * same table, so either place can be used and both agree.
 */

const container = document.querySelector<HTMLElement>("#settings");
if (!container) throw new Error("options page markup is missing #settings");

installDataDebugHandle("extension-page");
// Every other setting is read where it is used, but the panel's size is
// drawn, so a change here is published for any open panel to pick up. This
// page keeps its own size: it is a tab, and the browser's zoom works on it.
render(h(SettingsPane, { onChange: () => void getSettings().then((settings) => publishScale(settings["appearance.scale"])) }), container);
