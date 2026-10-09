import { SOURCES, hostsOf, sourceForUrl } from "../sources";
import type { SourceDescriptor } from "../sources/contract";
import type { SourceId } from "../sources/descriptors";
import { sendToTab } from "../lib/messages";
import { warn } from "../lib/log";
import apartmentsScript from "../sources/apartments/apartments.content.ts?script";
import exampleScript from "../sources/example/example.content.ts?script";
import zillowScript from "../sources/zillow/zillow.content.ts?script";
import zillowMain from "../sources/zillow/zillow.main.ts?script&iife";

/**
 * Keeps each source's content scripts registered exactly when the user has
 * granted that source's hosts. Sources are opt-in, so their scripts are
 * registered with chrome.scripting rather than declared in the manifest.
 * Registrations persist, so this only has to be right when something changes:
 * install and update (the built paths carry a hash), a grant added or removed,
 * and browser start. Tabs already open get a script injected when they have
 * none (`sweepOpenTabs`, and `ensureScriptsIn` for one tab on demand).
 */

/**
 * Each source's built scripts: the content script (isolated world) and, for
 * Zillow, a main-world script that reads the page's own JavaScript state.
 * The `?script` import is CRXJS: it builds the file as its own entry and
 * hands back the output path. Paths come first in the tuple because CRXJS
 * replaces each import by matching a placeholder followed by `,` or `;`.
 */
const SCRIPTS: Record<SourceId, readonly [content: string, main: string | null]> = {
    apartments: [apartmentsScript, null],
    zillow: [zillowScript, zillowMain],
    example: [exampleScript, null],
};

const SCRIPT_ID_PREFIX = "source:";

function scriptIdOf(source: SourceDescriptor): string {
    return `${SCRIPT_ID_PREFIX}${source.id}`;
}

export function isSourceGranted(source: SourceDescriptor): Promise<boolean> {
    return chrome.permissions.contains({ origins: hostsOf(source) });
}

/** The registrations a source wants: its content script, and its main-world script when it has one. */
function registrations(source: SourceDescriptor): chrome.scripting.RegisteredContentScript[] {
    const [content, main] = SCRIPTS[source.id as SourceId];
    const list: chrome.scripting.RegisteredContentScript[] = [{ id: scriptIdOf(source), js: [content], matches: source.hosts.pages, runAt: "document_idle", persistAcrossSessions: true }];
    if (main) list.push({ id: `${scriptIdOf(source)}:main`, js: [main], matches: source.hosts.pages, runAt: "document_idle", world: "MAIN", persistAcrossSessions: true });
    return list;
}

/** Runs the source's scripts in one tab. Throws when the tab cannot take them. */
async function injectInto(source: SourceDescriptor, tabId: number): Promise<void> {
    const [content, main] = SCRIPTS[source.id as SourceId];
    if (main) await chrome.scripting.executeScript({ target: { tabId }, files: [main], world: "MAIN" });
    await chrome.scripting.executeScript({ target: { tabId }, files: [content] });
}

async function isScripted(tabId: number): Promise<boolean> {
    return (await sendToTab(tabId, { type: "status" })) !== undefined;
}

/** Runs the source's scripts in every open tab on its hosts where none answers. Asking first keeps it cheap enough to repeat on every worker start. */
async function injectIntoOpenTabs(source: SourceDescriptor): Promise<void> {
    const tabs = await chrome.tabs.query({ url: source.hosts.pages });
    await Promise.all(
        tabs.map(async (tab) => {
            if (tab.id === undefined || (await isScripted(tab.id))) return;
            try {
                await injectInto(source, tab.id);
            } catch {
                // A chrome:// error page, a discarded tab: nothing to inject into.
            }
        }),
    );
}

export async function sweepOpenTabs(): Promise<void> {
    for (const source of SOURCES) {
        if (await isSourceGranted(source)) await injectIntoOpenTabs(source);
    }
}

/** Puts a granted source's scripts into a tab that should have them and does not answer. False for a tab on no granted source's pages, or one that cannot take a script. */
export async function ensureScriptsIn(tabId: number): Promise<boolean> {
    let url: string | undefined;
    try {
        url = (await chrome.tabs.get(tabId)).url;
    } catch {
        return false;
    }
    const source = url ? sourceForUrl(url) : null;
    if (!source || !(await isSourceGranted(source))) return false;
    try {
        await injectInto(source, tabId);
        warn(`${source.label} tab ${tabId} had no content script; injected one`);
        return true;
    } catch (error) {
        warn(`${source.label} tab ${tabId} could not take a content script`, error);
        return false;
    }
}

/** Makes registrations match grants. Idempotent; `force` re-registers granted sources (after an update the built paths changed). */
export async function reconcileSources(options: { injectOpenTabs?: boolean; force?: boolean } = {}): Promise<void> {
    const registered = new Set((await chrome.scripting.getRegisteredContentScripts()).map((script) => script.id));
    const toRegister: chrome.scripting.RegisteredContentScript[] = [];
    const toUpdate: chrome.scripting.RegisteredContentScript[] = [];
    const toRemove: string[] = [];
    const touched: SourceDescriptor[] = [];

    for (const source of SOURCES) {
        const granted = await isSourceGranted(source);
        let moved = false;
        for (const registration of registrations(source)) {
            const has = registered.has(registration.id);
            if (granted && !has) {
                toRegister.push(registration);
                moved = true;
            } else if (granted && has && options.force) {
                toUpdate.push(registration);
                moved = true;
            } else if (!granted && has) {
                toRemove.push(registration.id);
            }
        }
        if (granted && moved) touched.push(source);
    }

    // Registrations for sources or scripts this build no longer has.
    const wanted = new Set(SOURCES.flatMap((source) => registrations(source).map((r) => r.id)));
    for (const id of registered) {
        if (id.startsWith(SCRIPT_ID_PREFIX) && !wanted.has(id)) toRemove.push(id);
    }

    if (toRemove.length) await chrome.scripting.unregisterContentScripts({ ids: toRemove });
    if (toUpdate.length) await chrome.scripting.updateContentScripts(toUpdate);
    if (toRegister.length) await chrome.scripting.registerContentScripts(toRegister);
    if (options.injectOpenTabs) await Promise.all(touched.map(injectIntoOpenTabs));
}

/** Wires the events that can change a grant or a registration. Call once from the worker's top level. */
export function watchSources(): void {
    chrome.runtime.onInstalled.addListener(() => void reconcileSources({ force: true }).then(sweepOpenTabs));
    chrome.runtime.onStartup.addListener(() => void reconcileSources().then(sweepOpenTabs));
    chrome.permissions.onAdded.addListener(() => void reconcileSources({ injectOpenTabs: true }));
    chrome.permissions.onRemoved.addListener(() => void reconcileSources());
}
