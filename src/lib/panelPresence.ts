/**
 * Which windows have the side panel open, which Chrome does not expose: the
 * panel opens a port to the worker and sends its window id, and an open port
 * means an open panel. The panel reconnects when the idle worker is stopped.
 */

const PORT_NAME = "side-panel";
const RECONNECT_MS = 500;

/** Panel side: announce this page, and again after the worker restarts. */
export function announcePanel(): void {
    const port = chrome.runtime.connect({ name: PORT_NAME });
    void chrome.windows.getCurrent().then((window) => {
        if (window.id !== undefined) port.postMessage({ windowId: window.id });
    });
    port.onDisconnect.addListener(() => setTimeout(announcePanel, RECONNECT_MS));
}

const openPanels = new Map<chrome.runtime.Port, number>();

/** Worker side: remember each open panel's window while its port lasts. */
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
