/**
 * Tracks which windows have the side panel open. Chrome does not expose this.
 *
 * How it works: when the panel page loads, it opens a port to the service
 * worker and sends its window id. The worker keeps the window id for as long
 * as the port stays connected. An open port means an open panel.
 *
 * Chrome stops the worker after about thirty seconds idle, which closes every
 * port. The panel reconnects when that happens, so the worker keeps running
 * while any panel is open.
 *
 * Why it is needed: `togglePanel` in background.ts must choose between hiding
 * and opening without awaiting anything, because `chrome.sidePanel.open()`
 * only works inside the user gesture that triggered it. The answer therefore
 * has to be in memory already.
 *
 * Both halves live in this file so the port name and message shape have one
 * owner.
 */

const PORT_NAME = "side-panel";
const RECONNECT_MS = 500;

/** Panel side: announce this page, and keep announcing it after the worker restarts. */
export function announcePanel(): void {
    const port = chrome.runtime.connect({ name: PORT_NAME });
    void chrome.windows.getCurrent().then((window) => {
        if (window.id !== undefined) port.postMessage({ windowId: window.id });
    });
    port.onDisconnect.addListener(() => setTimeout(announcePanel, RECONNECT_MS));
}

const openPanels = new Map<chrome.runtime.Port, number>();

/** Worker side: remember each open panel's window until its port goes away. */
export function trackPanels(): void {
    chrome.runtime.onConnect.addListener((port) => {
        if (port.name !== PORT_NAME) return;
        port.onMessage.addListener((message: unknown) => {
            const windowId = (message as { windowId?: unknown } | null)?.windowId;
            if (typeof windowId === "number") openPanels.set(port, windowId);
        });
        port.onDisconnect.addListener(() => openPanels.delete(port));
    });
}

export function panelOpenIn(windowId: number): boolean {
    return [...openPanels.values()].includes(windowId);
}

/** The windows with a panel open, for the console handle and the specs. */
export function openPanelWindows(): number[] {
    return [...openPanels.values()];
}
