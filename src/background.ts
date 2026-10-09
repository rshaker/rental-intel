import { isMessage, type Message } from "./lib/messages";
import { forwardLogTo, warn } from "./lib/log";
import { installConsoleHandle } from "./lib/consoleHandle";
import { panelOpenIn, trackPanels } from "./lib/panelPresence";
import { watchSources } from "./worker/sources";
import { saveTab } from "./worker/save";

/** The service worker: shows and hides the side panel per tab, keeps content scripts registered (worker/sources.ts), and saves what a tab shows (worker/save.ts). */

const OPEN_PANEL_MENU_ID = "open-side-panel";
const PANEL_PATH = chrome.runtime.getManifest().side_panel?.default_path ?? "src/panel/index.html";

chrome.runtime.onInstalled.addListener(() => {
    // Chrome's own click-to-open is per window; this panel is per tab.
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: OPEN_PANEL_MENU_ID,
            title: "Show or hide Rental Intel",
            contexts: ["action", "page"],
        });
    });
});

// Off by default; enabled only on the tabs that asked.
void chrome.sidePanel.setOptions({ enabled: false });

/** The tabs the panel is enabled on, kept in memory because `togglePanel` cannot await `sidePanel.getOptions`. */
const panelTabs = new Set<number>();

async function refreshPanelTab(tabId: number): Promise<void> {
    try {
        const { enabled } = await chrome.sidePanel.getOptions({ tabId });
        if (enabled) panelTabs.add(tabId);
        else panelTabs.delete(tabId);
    } catch {
        panelTabs.delete(tabId);
    }
}

chrome.tabs.onActivated.addListener(({ tabId }) => void refreshPanelTab(tabId));
chrome.tabs.onRemoved.addListener((tabId) => panelTabs.delete(tabId));
void chrome.tabs.query({ active: true }).then((tabs) => {
    for (const tab of tabs) if (tab.id !== undefined) void refreshPanelTab(tab.id);
});

/** Hides the panel if it is showing on this tab (enabled here and open in the window), otherwise shows it. Nothing is awaited: `sidePanel.open` only works inside the user gesture. */
function togglePanel(tab: chrome.tabs.Tab | undefined): void {
    if (tab?.id === undefined || tab.windowId === undefined) return;
    if (panelTabs.has(tab.id) && panelOpenIn(tab.windowId)) {
        panelTabs.delete(tab.id);
        void chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false });
        return;
    }
    panelTabs.add(tab.id);
    void chrome.sidePanel.setOptions({ tabId: tab.id, path: PANEL_PATH, enabled: true });
    void chrome.sidePanel.open({ tabId: tab.id }).catch((error: unknown) => warn("side panel open failed", error));
}

chrome.action.onClicked.addListener((tab) => togglePanel(tab));

chrome.commands.onCommand.addListener((command, tab) => {
    if (command === "open-side-panel") togglePanel(tab);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === OPEN_PANEL_MENU_ID) togglePanel(tab);
});

trackPanels();
watchSources();

chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
    if (!isMessage(raw)) return false;

    switch (raw.type) {
        case "save-tab": {
            void saveTab(raw.tabId, raw.expect).then((result) => {
                sendResponse({ type: "save-tab-response", ...result } satisfies Message);
            });
            return true;
        }

        default:
            return false;
    }
});

installConsoleHandle();
forwardLogTo("worker");
