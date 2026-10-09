import { db } from "../db/db";
import { deleteListings, findByRef, getListing, hasChanged, listListings, updateUserFields, upsertCapture } from "../db/listings";
import { getPhotos, linkPhotos, putPhoto } from "../db/photos";
import { getRawCapture, getSnapshots } from "../db/history";
import { getSettings, resetSettings, setSetting } from "../db/settings";
import { openPanelWindows } from "./panelPresence";
import { baseHandle, setHandle, type DebugContext, type DebugHandle } from "./debug";
import { SOURCES } from "../sources";

/**
 * The db-backed half of the console handle, for the contexts that own the
 * database: the service worker and the extension pages.
 *
 * Kept in its own module so that importing it is a deliberate act. Content
 * scripts import lib/debug.ts alone, which means Dexie never enters a site's
 * page bundle -- a guarantee the bundler enforces statically.
 *
 *   __intel.list()                          -- every listing, newest first
 *   __intel.list("building")                -- only one kind
 *   __intel.find({ source: "apartments", sourceId: "kvl7tm9" })
 *   __intel.raw(id)                         -- the raw payload of a listing's last capture
 *   __intel.history(id)                     -- its snapshots
 *   __intel.db.photos.count()               -- how many photo blobs are stored
 *   __intel.settings.get()                  -- every setting, resolved against its default
 *   __intel.settings.set("bulk.pace", 5)    -- change one; settings.reset() puts them all back
 *   __intel.sources                         -- the descriptors this build carries
 *   __intel.panels()                        -- (worker) windows with the side panel open
 */
export interface DataDebugHandle extends DebugHandle {
    db: typeof db;
    list: typeof listListings;
    get: typeof getListing;
    find: typeof findByRef;
    upsert: typeof upsertCapture;
    setUser: typeof updateUserFields;
    remove: typeof deleteListings;
    hasChanged: typeof hasChanged;
    raw: typeof getRawCapture;
    history: typeof getSnapshots;
    photos: {
        of: typeof getPhotos;
        put: typeof putPhoto;
        link: typeof linkPhotos;
    };
    settings: {
        get: typeof getSettings;
        set: typeof setSetting;
        reset: typeof resetSettings;
    };
    sources: typeof SOURCES;
    /** Windows with a panel open. Only the worker keeps this list; elsewhere it is empty. */
    panels: typeof openPanelWindows;
}

/** Installs the full handle in a context that runs on the extension's own origin. */
export function installDataDebugHandle(context: Exclude<DebugContext, "isolated-world">): void {
    const handle: DataDebugHandle = {
        ...baseHandle(context),
        db,
        list: listListings,
        get: getListing,
        find: findByRef,
        upsert: upsertCapture,
        setUser: updateUserFields,
        remove: deleteListings,
        hasChanged,
        raw: getRawCapture,
        history: getSnapshots,
        photos: { of: getPhotos, put: putPhoto, link: linkPhotos },
        settings: { get: getSettings, set: setSetting, reset: resetSettings },
        sources: SOURCES,
        panels: openPanelWindows,
    };
    setHandle(handle);
}
