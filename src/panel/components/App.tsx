import { effect, untracked } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { setSetting } from "../../db/settings";
import { isMessage } from "../../lib/messages";
import { activity } from "../activityLog";
import { enabledSources, isEnabled } from "../grants";
import { liveSettings } from "../live";
import { activeListing, activeTab, captureActiveTab, captureNote, ordered, photosArriving, photosNote } from "../model";
import { applyScale, scaleShortcut, steppedScale } from "../scale";
import { clearSelection, confirmingDelete, selectAllVisible, selected } from "../selection";
import { forgetAllCards, isCardOpen, resetFilters, setCardOpen, tab } from "../store";
import { carousels } from "./Card";
import { DataPane, dataStatus } from "./DataPane";
import { CaptureRow, FiltersHeader, ListTools, ListingList } from "./ListingsTab";
import { LoadDialog, openLoadDialog } from "./LoadDialog";
import { SearchPane } from "./SearchPane";
import { SettingsPane } from "./SettingsPane";
import { SourcesPane } from "./SourcesPane";

/**
 * The side panel. Five tabs: Listings, with the capture row, the Filters
 * card, the list toolbar and the cards; Search (the sites themselves,
 * through the tab beside the panel); Sources (which sites are enabled);
 * Data (backups, Load URLs, the activity log); Options (the settings
 * form). Every tab's content is mounted once and kept current by the
 * signals it reads; which tab shows is the `tab` signal.
 *
 * The panel talks to Dexie directly -- it runs in the extension origin, same
 * as the worker, so both see the same database, and Dexie's live queries
 * carry the worker's saves here without a message.
 */

const TABS = [
    ["listings", "Listings", "root"],
    ["search", "Search", "search-pane"],
    ["sources", "Sources", "sources"],
    ["data", "Data", "data"],
    ["options", "Options", "options"],
] as const;

/** A line for the activity log, from the Search tab or the Load URLs dialog. */
const logLine = (text: string, tone: "" | "good" | "bad" | "dim"): void => activity.say(text, tone === "bad" ? "warn" : "info");

/**
 * Opens a card and scrolls to it. If a filter hides the card, the filters
 * are reset: a jump the user asked for beats a view they set earlier. The
 * scroll waits a tick for the list to repaint.
 */
function jumpToListing(id: string): void {
    setCardOpen(id, true);
    tab.value = "listings";
    if (!ordered.value.some((listing) => listing.id === id)) resetFilters();
    setTimeout(() => {
        const card = document.querySelector<HTMLElement>(`.card[data-id="${CSS.escape(id)}"]`);
        const head = document.querySelector<HTMLElement>(".head");
        if (!card) return;
        // The sticky header covers the top of the page. The margin stops the card 8px below it.
        card.style.scrollMarginTop = `${(head?.offsetHeight ?? 0) + 8}px`;
        card.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 50);
}

/** The database was replaced or emptied under every open card. */
async function afterDataChange(): Promise<void> {
    forgetAllCards();
    clearSelection();
}

// A new tab or a new page retires the last capture's note; a fresh answer for the same page does not.
let lastTabKey = "";
effect(() => {
    const { tabId, url } = activeTab.state.value;
    const key = `${tabId}\n${url}`;
    if (key !== lastTabKey) {
        lastTabKey = key;
        captureNote.value = "";
    }
});

// A grant changed: a newly enabled site's tab can answer now. The recheck
// reads and writes the tab's own signal, so it runs untracked: this effect
// depends on the grants alone.
let watchingGrants = false;
effect(() => {
    void enabledSources.value;
    if (watchingGrants) untracked(() => activeTab.recheck());
});
watchingGrants = true;

// The Size setting is drawn on every change, from wherever it was made.
effect(() => applyScale(liveSettings.value["appearance.scale"]));

export function App() {
    const current = tab.value;
    const [preview, setPreview] = useState<string | null>(null);

    // Messages from the worker: photos arriving for a save, and warnings from other contexts.
    useEffect(() => {
        const onMessage = (raw: unknown): boolean => {
            if (!isMessage(raw)) return false;
            if (raw.type === "photos-progress") {
                const arriving = photosArriving.value;
                if (arriving?.listingId === raw.listingId && captureNote.value.startsWith("Saved. Fetching")) {
                    if (raw.done >= raw.total) {
                        photosArriving.value = null;
                        captureNote.value = "Saved.";
                    } else {
                        photosArriving.value = { ...arriving, done: raw.done, total: raw.total };
                        captureNote.value = photosNote();
                    }
                }
            } else if (raw.type === "log-line") activity.say(`${raw.context}: ${raw.text}`, raw.level);
            return false;
        };
        chrome.runtime.onMessage.addListener(onMessage);
        return () => chrome.runtime.onMessage.removeListener(onMessage);
    }, []);

    // One keyboard handler for the panel. Every branch first checks whether the
    // key belongs to the browser here: inside the notes textarea, the status
    // select or a filter input, ctrl-a selects text and the arrows move the
    // caret, and nothing below may take that away.
    useEffect(() => {
        const onKey = (event: KeyboardEvent): void => {
            const target = event.target instanceof HTMLElement ? event.target : null;
            const editable = target !== null && (target.matches("input, textarea, select") || target.isContentEditable);

            // Ctrl/⌘ with + − 0 size the panel, wherever the focus is -- the same
            // keys zoom a page, and in a side panel they would zoom the tab instead.
            const step = scaleShortcut(event);
            if (step !== null) {
                event.preventDefault();
                const next = steppedScale(step);
                applyScale(next);
                void setSetting("appearance.scale", next);
                return;
            }

            if (event.key === "Escape") {
                if (editable || selected.value.size === 0) return;
                event.preventDefault();
                if (confirmingDelete.value) confirmingDelete.value = false;
                else clearSelection();
                return;
            }

            const mod = (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey;
            // Select all -- but only once a selection has begun, so the panel's text stays selectable the rest of the time.
            if (mod && event.key.toLowerCase() === "a") {
                if (selected.value.size === 0 || editable) return;
                event.preventDefault(); // otherwise Chrome selects the panel's text
                selectAllVisible();
                return;
            }

            // Cmd/Ctrl+F goes to the search box: the browser's own find cannot see
            // into closed cards, and the box searches everything the panel holds.
            if (mod && event.key.toLowerCase() === "f") {
                if (tab.value !== "listings") return;
                event.preventDefault();
                const search = document.querySelector<HTMLInputElement>("#search");
                search?.focus();
                search?.select();
                return;
            }

            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                if (editable) return;
                // "The card that has focus": its summary after a click, the carousel arrows, the link -- anything focusable inside it.
                const id = target?.closest<HTMLElement>(".card[data-id]")?.dataset["id"];
                const stepCarousel = id === undefined ? undefined : carousels.get(id);
                if (id === undefined || !stepCarousel || !isCardOpen(id)) return;
                event.preventDefault();
                stepCarousel(event.key === "ArrowRight" ? 1 : -1);
            }
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, []);

    // Link preview. Chrome shows a hovered link's address at the foot of a tab,
    // but not of a side panel, so the panel shows its own: the href of any link
    // under the pointer or with focus, and for a jump, the card it goes to.
    useEffect(() => {
        const previewOf = (target: EventTarget | null): string | null => {
            if (!(target instanceof Element)) return null;
            const link = target.closest<HTMLAnchorElement>("a[href]");
            if (link) return link.href;
            return target.closest<HTMLElement>(".jump")?.dataset["preview"] ?? null;
        };
        const over = (event: Event): void => setPreview(previewOf(event.target));
        const out = (event: MouseEvent): void => {
            if (event.relatedTarget === null) setPreview(null); // left the panel altogether
        };
        const clear = (): void => setPreview(null);
        document.addEventListener("mouseover", over);
        document.addEventListener("mouseout", out);
        document.addEventListener("focusin", over);
        document.addEventListener("focusout", clear);
        return () => {
            document.removeEventListener("mouseover", over);
            document.removeEventListener("mouseout", out);
            document.removeEventListener("focusin", over);
            document.removeEventListener("focusout", clear);
        };
    }, []);

    const capture = async (): Promise<void> => {
        const id = await captureActiveTab();
        if (id) jumpToListing(id);
    };
    /** Show card: the saved listing for what the active tab is showing, opened and scrolled to. */
    const locate = (): void => {
        const id = activeListing.value?.id;
        if (id) jumpToListing(id);
    };

    return (
        <>
            <header class="head">
                {/* Chrome gives a side panel no tabs of its own, so these are plain buttons; which one is open persists. */}
                <nav class="tabs" role="tablist" aria-label="Panel">
                    {TABS.map(([name, label, controls]) => (
                        <button key={name} type="button" role="tab" data-tab={name} aria-selected={current === name} aria-controls={controls} onClick={() => (tab.value = name)}>
                            {label}
                        </button>
                    ))}
                </nav>
                <div id="listings-head" hidden={current !== "listings"}>
                    <CaptureRow onCapture={() => void capture()} onLocate={locate} />
                    <FiltersHeader />
                    <ListTools />
                </div>
            </header>
            <main id="root" class="root" hidden={current !== "listings"}>
                <ListingList onJump={jumpToListing} />
            </main>
            <section id="search-pane" class="search" role="tabpanel" hidden={current !== "search"}>
                <SearchPane onLine={logLine} onLoad={openLoadDialog} />
            </section>
            <section id="sources" class="sources" role="tabpanel" hidden={current !== "sources"}>
                <SourcesPane />
            </section>
            <section id="data" class="data" role="tabpanel" hidden={current !== "data"}>
                <DataPane onLoadUrls={() => openLoadDialog()} onChanged={afterDataChange} />
            </section>
            <section id="options" class="settings" role="tabpanel" hidden={current !== "options"}>
                <SettingsPane />
            </section>
            <div id="link-preview" class="link-preview" hidden={preview === null}>
                {preview ?? ""}
            </div>
            {/* Modal, so nothing behind it can change the database mid-run. Its transcript reaches the
                activity log line by line, and its summary is one of those lines, so the status takes it unlogged. */}
            <LoadDialog onStatus={(text) => (dataStatus.value = text)} onLine={logLine} isEnabled={isEnabled} />
        </>
    );
}
