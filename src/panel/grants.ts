import { signal } from "@preact/signals";
import { SOURCES, hostsOf } from "../sources";
import type { SourceDescriptor } from "../sources/contract";
import { errorText } from "./format";

/** Which sources are enabled: those whose hosts Chrome has granted, refreshed on every grant change. */

export const enabledSources = signal<ReadonlySet<string>>(new Set());

/** What the last switch of a source came to when it did not go through, by id, for its row. */
export const grantNotes = signal<ReadonlyMap<string, string>>(new Map());

export function isEnabled(source: SourceDescriptor): boolean {
    return enabledSources.value.has(source.id);
}

export async function refreshGrants(): Promise<void> {
    const flags = await Promise.all(SOURCES.map((source) => chrome.permissions.contains({ origins: hostsOf(source) })));
    enabledSources.value = new Set(SOURCES.filter((_, i) => flags[i]).map((source) => source.id));
}

/** Asks Chrome for a source's hosts, or gives them back. Must run inside the user's click. A test build declares the hosts as required, and the row says so. */
export async function toggleSource(source: SourceDescriptor): Promise<void> {
    const origins = hostsOf(source);
    const notes = new Map(grantNotes.value);
    notes.delete(source.id);
    try {
        if (isEnabled(source)) {
            const removed = await chrome.permissions.remove({ origins });
            if (!removed) notes.set(source.id, "Chrome kept this site's access; it is required by this build.");
        } else {
            const granted = await chrome.permissions.request({ origins });
            if (!granted) notes.set(source.id, "Not enabled: the permission was declined.");
        }
    } catch (error) {
        const message = errorText(error);
        notes.set(source.id, /required/i.test(message) ? "Chrome kept this site's access; it is required by this build." : message);
    }
    grantNotes.value = notes;
    await refreshGrants();
}

chrome.permissions.onAdded.addListener(() => void refreshGrants());
chrome.permissions.onRemoved.addListener(() => void refreshGrants());
void refreshGrants();
