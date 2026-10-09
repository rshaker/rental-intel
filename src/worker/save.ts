import { findByRef, hasChanged, upsertCapture } from "../db/listings";
import { linkPhotos, putPhoto } from "../db/photos";
import { getSettings } from "../db/settings";
import { sameRef, type Capture, type ListingRef } from "../db/types";
import { broadcast, sendToTab, type ExtractResponse, type SaveTabResponse } from "../lib/messages";
import { log, LogLevels } from "../lib/logging";
import { isSourceId } from "../sources";
import { ensureScriptsIn } from "./sources";
import pLimit from "p-limit";

/**
 * The save action, shared by the panel's capture button and its bulk loader.
 * Runs here because the photo fetch needs the worker's host permissions.
 *
 * The record is written and answered for first; the photos follow. A large
 * building has fifty photos at full size, and fetching them is most of the
 * time a save takes, so the panel hears "saved" at once and watches the
 * photos arrive. The panel's live queries see every write, so no message
 * says "the listings changed"; only the photo progress travels.
 */

/** How many photos are fetched at a time. Enough to hide latency, few enough not to look like a scraper. */
const PHOTO_CONCURRENCY = 4;
/** A progress message every this many photos. */
const PROGRESS_EVERY = 4;

/**
 * Fetches a listing's photos into IndexedDB, a few at a time, in the site's
 * order. Done here rather than in the content script because the worker's
 * host permissions cover the photo CDN. The listing keeps every URL
 * regardless of how many are stored.
 */
async function capturePhotos(id: string, urls: string[]): Promise<void> {
    const limit = pLimit(PHOTO_CONCURRENCY);
    let done = 0;
    const fetchOne = async (url: string): Promise<string | null> => {
        try {
            const response = await fetch(url);
            return response.ok ? await putPhoto(await response.blob(), url) : null;
        } catch (error) {
            log(LogLevels.WARN, "photo fetch failed", url, error);
            return null;
        } finally {
            done += 1;
            if (done % PROGRESS_EVERY === 0 && done < urls.length) broadcast({ type: "photos-progress", listingId: id, done, total: urls.length });
        }
    };
    const hashes = await Promise.all(urls.map((url) => limit(fetchOne, url)));
    // Order preserved: a photo that failed is left out, the rest keep their places.
    await linkPhotos(id, hashes.filter((hash): hash is string => hash !== null));
    broadcast({ type: "photos-progress", listingId: id, done: urls.length, total: urls.length });
}

/** The photos a save will fetch, as the settings allow. Off means "fetch nothing", not "discard". */
async function wantedPhotos(urls: string[]): Promise<string[]> {
    const settings = await getSettings();
    if (!settings["photos.save"]) return [];
    const limit = settings["photos.limit"];
    return limit > 0 ? urls.slice(0, limit) : urls;
}

/** Photo fetches in flight, by listing id, so a re-capture does not race the one before it. */
const inFlight = new Map<string, Promise<void>>();

function fetchPhotosLater(id: string, urls: string[]): void {
    const previous = inFlight.get(id) ?? Promise.resolve();
    const run = previous
        .then(() => capturePhotos(id, urls))
        .catch((error: unknown) => {
            log(LogLevels.WARN, "photo capture failed", id, error);
            broadcast({ type: "photos-progress", listingId: id, done: urls.length, total: urls.length });
        })
        .finally(() => {
            if (inFlight.get(id) === run) inFlight.delete(id);
        });
    inFlight.set(id, run);
}

/**
 * Asks a just-injected content script for the page, waiting for it to be up.
 * The file `executeScript` runs is CRXJS's loader, which `import()`s the
 * script proper; the injection call returns when the loader has, a moment
 * before the script is listening. A few short waits cover that moment; a
 * page that still says nothing after them is not going to.
 */
async function askOnceUp(tabId: number): Promise<ExtractResponse | undefined> {
    for (const delay of [0, 50, 100, 200, 400, 800]) {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        const response = await sendToTab<ExtractResponse>(tabId, { type: "extract" });
        if (response !== undefined) return response;
    }
    return undefined;
}

/**
 * `expect` is described on `SaveTab` in lib/messages.ts. The result names the
 * listing, so the panel can open its card, and says how many photos are on
 * their way.
 */
export async function saveTab(tabId: number, expect?: ListingRef): Promise<Omit<SaveTabResponse, "type">> {
    let response = await sendToTab<ExtractResponse>(tabId, { type: "extract" });
    if (response === undefined) {
        // Nobody answered. On a page of a granted source that is the script
        // missing, not the page: put one there and ask again. Anywhere else
        // (a search engine, a source that is off) there is rightly no one.
        if (!(await ensureScriptsIn(tabId))) return { outcome: "nothing" };
        response = await askOnceUp(tabId);
        if (response === undefined) return { outcome: "unreachable" };
    }
    if (!response.capture || !isSourceId(response.source)) {
        // Not an error. The button offers a try on every page, so a search page lands here.
        log(LogLevels.DEBUG, "forced parse found nothing", tabId);
        return { outcome: "nothing" };
    }
    const capture: Capture = { ...response.capture, source: response.source };
    if (expect && !sameRef(capture, expect)) {
        log(LogLevels.DEBUG, "tab answered for another listing", tabId, expect, capture.sourceId);
        return { outcome: "other" };
    }

    const ref: ListingRef = { source: capture.source, sourceId: capture.sourceId };
    const existing = await findByRef(capture);
    if (existing && !hasChanged(existing, capture)) return { outcome: "unchanged", listingId: existing.id, ref, partial: capture.partial, photos: 0 };

    const { id } = await upsertCapture(capture);

    const urls = await wantedPhotos(capture.core.photoUrls);
    if (urls.length) fetchPhotosLater(id, urls);
    return { outcome: "saved", listingId: id, ref, partial: capture.partial, photos: urls.length };
}
