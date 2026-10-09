import { findByRef, hasChanged, upsertCapture } from "../db/listings";
import { linkPhotos, putPhoto } from "../db/photos";
import { getSettings } from "../db/settings";
import { sameRef, type Capture, type ListingRef } from "../db/types";
import { broadcast, sendToTab, type ExtractResponse, type SaveTabResponse } from "../lib/messages";
import { warn } from "../lib/log";
import { poll } from "../lib/poll";
import { isSourceId } from "../sources";
import { ensureScriptsIn } from "./sources";

/**
 * The save action, shared by the capture button and the URL-list loader. It
 * runs in the worker because the photo fetch needs the worker's host
 * permissions. The record is written and answered for first; the photos
 * follow, and the panel's live queries see every write.
 */

/** How many photos are fetched at a time. */
const PHOTO_CONCURRENCY = 4;
/** A progress message every this many photos. */
const PROGRESS_EVERY = 4;

/** Runs `run` over `items` at most `limit` at a time; the results keep their places. */
async function mapLimited<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const lane = async (): Promise<void> => {
        while (next < items.length) {
            const index = next++;
            results[index] = await run(items[index]!);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
    return results;
}

/** Fetches a listing's photos into IndexedDB in the site's order. The listing keeps every URL regardless of how many are stored. */
async function capturePhotos(id: string, urls: string[]): Promise<void> {
    let done = 0;
    const hashes = await mapLimited(urls, PHOTO_CONCURRENCY, async (url): Promise<string | null> => {
        try {
            const response = await fetch(url);
            return response.ok ? await putPhoto(await response.blob(), url) : null;
        } catch (error) {
            warn("photo fetch failed", url, error);
            return null;
        } finally {
            done += 1;
            if (done % PROGRESS_EVERY === 0 && done < urls.length) broadcast({ type: "photos-progress", listingId: id, done, total: urls.length });
        }
    });
    await linkPhotos(id, hashes.filter((hash): hash is string => hash !== null));
    broadcast({ type: "photos-progress", listingId: id, done: urls.length, total: urls.length });
}

/** The photos a save will fetch, as the settings allow. */
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
            warn("photo capture failed", id, error);
            broadcast({ type: "photos-progress", listingId: id, done: urls.length, total: urls.length });
        })
        .finally(() => {
            if (inFlight.get(id) === run) inFlight.delete(id);
        });
    inFlight.set(id, run);
}

/** Asks a just-injected content script for the page, with a few short waits for it to come up. */
function askOnceUp(tabId: number): Promise<ExtractResponse | null> {
    const delays = [0, 50, 100, 200, 400, 800];
    return poll(() => sendToTab<ExtractResponse>(tabId, { type: "extract" }), (response) => response, { every: (attempt) => delays[attempt] ?? null });
}

/** Saves what the tab shows. With `expect`, a page answering for any other listing is not saved. The result names the listing and says how many photos are on their way. */
export async function saveTab(tabId: number, expect?: ListingRef): Promise<Omit<SaveTabResponse, "type">> {
    let response = await sendToTab<ExtractResponse>(tabId, { type: "extract" });
    if (response === undefined) {
        // Nobody answered. On a granted source's page that is the script missing, not the page: put one there and ask again.
        if (!(await ensureScriptsIn(tabId))) return { outcome: "no-listing" };
        response = (await askOnceUp(tabId)) ?? undefined;
        if (response === undefined) return { outcome: "unreachable" };
    }
    if (!response.capture || !isSourceId(response.source)) return { outcome: "no-listing" };
    const capture: Capture = { ...response.capture, source: response.source };
    if (expect && !sameRef(capture, expect)) return { outcome: "different-listing" };

    const ref: ListingRef = { source: capture.source, sourceId: capture.sourceId };
    const existing = await findByRef(capture);
    if (existing && !hasChanged(existing, capture)) return { outcome: "unchanged", listingId: existing.id, ref, partial: capture.partial, photos: 0 };

    const { id } = await upsertCapture(capture);
    const urls = await wantedPhotos(capture.core.photoUrls);
    if (urls.length) fetchPhotosLater(id, urls);
    return { outcome: "saved", listingId: id, ref, partial: capture.partial, photos: urls.length };
}
