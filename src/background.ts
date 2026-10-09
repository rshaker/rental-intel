import { isMessage, type Message } from "./lib/messages";
import { log, LogLevels } from "./lib/logging";
import { installDataDebugHandle } from "./lib/debug.data";
import { panelOpenIn, trackPanels } from "./lib/panelPresence";
import { watchSources } from "./worker/sources";
import { saveTab } from "./worker/save";

/**
 * The service worker. Three jobs: show and hide the side panel per tab, keep
 * each enabled source's content script registered (worker/sources.ts), and
 * save what a tab is showing (worker/save.ts).
 */

const OPEN_PANEL_MENU_ID = "open-side-panel";
const PANEL_PATH = chrome.runtime.getManifest().side_panel?.default_path ?? "src/panel/index.html";

chrome.runtime.onInstalled.addListener(() => {
    // Chrome's own click-to-open is per window; this panel is per tab, so the
    // click is handled by `togglePanel` below instead.
    void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

    // Creating a duplicate menu id fails, hence the removeAll.
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: OPEN_PANEL_MENU_ID,
            title: "Show or hide Rental Intel",
            contexts: ["action", "page"],
        });
    });
});

// The panel is per tab, not per window as Chrome would have it: off by default,
// enabled only on the tabs that asked, and Chrome shows or hides it as the user
// switches between them. Without a tabId this sets the default, so running it on
// every worker start disturbs no tab's own setting.
void chrome.sidePanel.setOptions({ enabled: false });

/**
 * The tabs the panel is enabled on. Chrome knows (`sidePanel.getOptions`) but
 * answers asynchronously, and `togglePanel` cannot wait for it, so the answer
 * is fetched ahead of time: when a tab becomes active, and for every active tab
 * when the worker starts.
 */
const panelTabs = new Set<number>();

async function refreshPanelTab(tabId: number): Promise<void> {
    try {
        const { enabled } = await chrome.sidePanel.getOptions({ tabId });
        if (enabled) panelTabs.add(tabId);
        else panelTabs.delete(tabId);
    } catch {
        panelTabs.delete(tabId); // the tab is gone
    }
}

chrome.tabs.onActivated.addListener(({ tabId }) => void refreshPanelTab(tabId));
chrome.tabs.onRemoved.addListener((tabId) => panelTabs.delete(tabId));
void chrome.tabs.query({ active: true }).then((tabs) => {
    for (const tab of tabs) if (tab.id !== undefined) void refreshPanelTab(tab.id);
});

/**
 * Hides the panel if it is showing on this tab, otherwise shows it here.
 *
 * "Showing on this tab" is two facts: enabled on the tab, and a panel open in
 * the window (lib/panelPresence.ts). Either alone misleads -- a panel opened on
 * a sibling tab is open but not enabled here, and a tab whose panel was closed
 * with the X is enabled but not open.
 *
 * Nothing is awaited before deciding: `sidePanel.open` only works inside the
 * user gesture that fired the click, command or menu item.
 */
function togglePanel(tab: chrome.tabs.Tab | undefined): void {
    if (tab?.id === undefined || tab.windowId === undefined) return;
    if (panelTabs.has(tab.id) && panelOpenIn(tab.windowId)) {
        panelTabs.delete(tab.id);
        void chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false });
        return;
    }
    panelTabs.add(tab.id);
    void chrome.sidePanel.setOptions({ tabId: tab.id, path: PANEL_PATH, enabled: true });
    void chrome.sidePanel.open({ tabId: tab.id }).catch((error: unknown) => log(LogLevels.WARN, "side panel open failed", error));
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
    log(LogLevels.MSGS, "worker received", raw.type);

    switch (raw.type) {
        case "save-tab": {
            void saveTab(raw.tabId, raw.expect).then((result) => {
                sendResponse({ type: "save-tab-response", ...result } satisfies Message);
            });
            return true; // holds the channel open for the async sendResponse
        }

        default:
            return false;
    }
});

installDataDebugHandle("background-worker");
log(LogLevels.INFO, "service worker started");
