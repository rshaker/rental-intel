import { scriptsOf } from "../sources/scripts";
import { SOURCES, hostsOf, sourceForUrl } from "../sources";
import type { SourceDescriptor } from "../sources/contract";
import type { SourceId } from "../sources/descriptors";
import { sendToTab } from "../lib/messages";
import { log, LogLevels } from "../lib/logging";

/**
 * Keeping each source's content scripts registered exactly when the user has
 * granted that source's hosts.
 *
 * Sources are opt-in. Their hosts are `optional_host_permissions` in the
 * manifest; the panel's Sources tab asks Chrome for them inside the user's
 * click. Once granted, the source's content script has to be registered with
 * chrome.scripting -- a static `content_scripts` entry in the manifest would
 * make the hosts required. Registrations persist across browser sessions, so
 * this only has to be right when something changes:
 *
 *   - install and update: the built script paths carry a content hash, so an
 *     update must re-register every source with its new path;
 *   - a permission granted or removed, by the panel or from chrome://extensions;
 *   - browser start, as a backstop.
 *
 * `reconcileSources` does all of it: for every source, registered iff granted.
 * When a source has just been granted, its scripts are also injected into the
 * tabs already open on its hosts, so the user does not have to reload them.
 *
 * Registrations cover documents that load from now on. Tabs already open
 * are the other half: after an update their scripts are orphans, and a tab
 * Chrome restores or wakes may come back with none. `sweepOpenTabs` asks
 * every open tab of a granted source whether a script answers and injects
 * where none does; it runs after install, update and browser start, and
 * the capture button does the same for one tab on demand (`ensureScriptsIn`).
 *
 * A source may have two scripts: the content script proper, in the isolated
 * world, and a page-world helper (`world: "MAIN"`) for reading the page's
 * own JavaScript state. Both are registered and injected together.
 */

const SCRIPT_ID_PREFIX = "source:";

function scriptIdOf(source: SourceDescriptor): string {
    return `${SCRIPT_ID_PREFIX}${source.id}`;
}

function mainScriptIdOf(source: SourceDescriptor): string {
    return `${SCRIPT_ID_PREFIX}${source.id}:main`;
}

export function isSourceGranted(source: SourceDescriptor): Promise<boolean> {
    return chrome.permissions.contains({ origins: hostsOf(source) });
}

/** The ids of the sources whose hosts are granted. */
export async function grantedSources(): Promise<string[]> {
    const flags = await Promise.all(SOURCES.map(isSourceGranted));
    return SOURCES.filter((_, i) => flags[i]).map((source) => source.id);
}

async function registeredIds(): Promise<Set<string>> {
    const scripts = await chrome.scripting.getRegisteredContentScripts();
    return new Set(scripts.map((script) => script.id));
}

/** The registrations a source wants: its content script, and its page-world helper when it has one. */
function registrations(source: SourceDescriptor): chrome.scripting.RegisteredContentScript[] {
    const scripts = scriptsOf(source.id as SourceId);
    const list: chrome.scripting.RegisteredContentScript[] = [
        {
            id: scriptIdOf(source),
            js: [scripts.content],
            matches: source.hosts.pages,
            runAt: "document_idle",
            persistAcrossSessions: true,
        },
    ];
    if (scripts.main) {
        list.push({
            id: mainScriptIdOf(source),
            js: [scripts.main],
            matches: source.hosts.pages,
            runAt: "document_idle",
            world: "MAIN",
            persistAcrossSessions: true,
        });
    }
    return list;
}

/** Runs the source's scripts in one tab (the scripts guard against running twice). Throws when the tab cannot take them. */
async function injectInto(source: SourceDescriptor, tabId: number): Promise<void> {
    const scripts = scriptsOf(source.id as SourceId);
    if (scripts.main) await chrome.scripting.executeScript({ target: { tabId }, files: [scripts.main], world: "MAIN" });
    await chrome.scripting.executeScript({ target: { tabId }, files: [scripts.content] });
}

/** Whether a content script answers in the tab. */
async function isScripted(tabId: number): Promise<boolean> {
    return (await sendToTab(tabId, { type: "status" })) !== undefined;
}

/**
 * Runs the source's scripts in every open tab on its hosts where none
 * answers. Asking first keeps this idempotent, so it can run on every start
 * of the worker as well as on a grant: a tab whose script is up costs one
 * message, and only a silent tab -- open before the grant, orphaned by a
 * reload of the extension, or woken by Chrome without its scripts -- is
 * injected. (Many extensions inject into every open tab at worker start
 * unconditionally and rely on the scripts' own takeover; the ask is what
 * makes it cheap enough to repeat.)
 */
async function injectIntoOpenTabs(source: SourceDescriptor): Promise<void> {
    const tabs = await chrome.tabs.query({ url: source.hosts.pages });
    await Promise.all(
        tabs.map(async (tab) => {
            if (tab.id === undefined || (await isScripted(tab.id))) return;
            try {
                await injectInto(source, tab.id);
                log(LogLevels.INFO, `${source.label} tab ${tab.id} had no content script; injected one`);
            } catch (error) {
                // A chrome:// error page, a discarded tab: nothing to inject into.
                log(LogLevels.DEBUG, "inject skipped", source.id, tab.id, error);
            }
        }),
    );
}

/** Every granted source's open tabs, scripted where they were silent. */
export async function sweepOpenTabs(): Promise<void> {
    for (const source of SOURCES) {
        if (await isSourceGranted(source)) await injectIntoOpenTabs(source);
    }
}

/**
 * Puts a granted source's scripts into a tab that should have them and does
 * not answer: the capture button's repair for a tab the sweeps missed or
 * that went silent since. Says whether the tab is now scripted. A tab on no
 * granted source's pages is left alone, and false.
 */
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
        log(LogLevels.WARN, `${source.label} tab ${tabId} had no content script; injected one`);
        return true;
    } catch (error) {
        log(LogLevels.WARN, `${source.label} tab ${tabId} could not take a content script`, error);
        return false;
    }
}

/**
 * Makes registrations match grants. Idempotent and cheap, so it is safe to
 * call on every event that could have changed either side. The panels watch
 * the grants themselves, through the same permissions events.
 */
export async function reconcileSources(options: { injectOpenTabs?: boolean; force?: boolean } = {}): Promise<void> {
    const registered = await registeredIds();
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
                // After an update the built path has changed; the registration must follow.
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

    if (toRegister.length || toRemove.length || toUpdate.length) {
        log(LogLevels.INFO, "sources reconciled", { registered: toRegister.map((r) => r.id), updated: toUpdate.map((r) => r.id), removed: toRemove });
    }
}

/** Wires the events that can change a grant or a registration. Call once from the worker's top level. */
export function watchSources(): void {
    // Install and update: registrations follow the new paths, then every open
    // tab of a granted source gets a script where its old one was orphaned.
    // Browser start: registrations are checked, and tabs Chrome restored
    // scripted where they came back silent.
    chrome.runtime.onInstalled.addListener(() => void reconcileSources({ force: true }).then(sweepOpenTabs));
    chrome.runtime.onStartup.addListener(() => void reconcileSources().then(sweepOpenTabs));
    chrome.permissions.onAdded.addListener(() => void reconcileSources({ injectOpenTabs: true }));
    chrome.permissions.onRemoved.addListener(() => void reconcileSources());
}
