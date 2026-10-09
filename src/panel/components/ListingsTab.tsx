import { useEffect, useState } from "preact/hooks";
import { deleteListings } from "../../db/listings";
import { LISTING_STATUSES, STATUS_LABELS, type ListingStatus } from "../../db/types";
import { SOURCES, sourceForUrl, sourceLabel } from "../../sources";
import { enabledSources, isEnabled } from "../grants";
import { liveSettings } from "../live";
import { plural } from "../format";
import { activeListing, activeTab, captureNote, captureState, everything, ordered, relations, saving } from "../model";
import { DEFAULT_FILTERS, NATURAL_DIR, SORT_KEYS, SORT_LABELS, activeFilterCount, isDefaultSort, type SortKey } from "../query";
import { anchorId, clearSelection, confirmingDelete, pruneSelection, selectAllVisible, selectWhere, selected, visibleIds } from "../selection";
import { controlsOpen, filters, forgetCards, photoMode, resetFilters, setCardsOpen, sort } from "../store";
import { Card, SECTION_NAMES } from "./Card";

/**
 * The Listings tab: the capture row, the Filters card, the list toolbar and
 * the cards. Everything here reads signals (model.ts, store.ts,
 * selection.ts) and repaints on its own.
 */

// ---------------------------------------------------------------------------
// The capture row
// ---------------------------------------------------------------------------

/**
 * What to say when nothing is confirmed. A page still being looked at says
 * so; a site that is off is the likely reason otherwise, and worth naming.
 */
function sourceNote(): string {
    const { url, checking, challenge } = activeTab.state.value;
    if (challenge) return challenge;
    if (checking) return "Checking this page…";
    if (url === null) return "No listing confirmed on this tab.";
    const source = sourceForUrl(url);
    if (source && !isEnabled(source)) return `${source.label} is not enabled. Turn it on under Sources.`;
    return "No listing confirmed on this tab.";
}

export function CaptureRow({ onCapture, onLocate }: { onCapture(): void; onLocate(): void }) {
    const state = captureState.value;
    const existing = activeListing.value;
    const label = { try: "Try to capture", new: "Add listing", update: "Update listing", saved: "Re-capture" }[state];
    const note = captureNote.value || { try: sourceNote(), new: "", update: "This page differs from what is saved.", saved: "Saved ✓" }[state];
    const ok = note === "Saved ✓" || note.startsWith("Saved.");
    return (
        <div id="capture" class="capture">
            <button id="capture-button" class={`tool${state === "new" || state === "update" ? " primary" : ""}`} type="button" disabled={activeTab.state.value.tabId === null || saving.value} onClick={onCapture}>
                {label}
            </button>
            <button id="locate-button" class="tool" type="button" disabled={!existing} title={existing ? "Show the card for this page" : "No card saved for this page"} onClick={onLocate}>
                Show card
            </button>
            <span id="capture-note" class={`capture-note${ok ? " ok" : ""}`} role="status">
                {note}
            </span>
        </div>
    );
}

// ---------------------------------------------------------------------------
// The Filters card: a header row that folds the rest; inside, the search box
// over saved listings and one labelled row per concern.
// ---------------------------------------------------------------------------

export function FiltersHeader() {
    const current = filters.value;
    const currentSort = sort.value;
    const open = controlsOpen.value;
    const all = everything.value.length;
    const shown = ordered.value.length;
    const activeCount = activeFilterCount(current);

    // The search box is debounced: rendering rebuilds every card, and typing is faster than that.
    const [query, setQuery] = useState(current.query);
    useEffect(() => setQuery(current.query), [current.query]);
    useEffect(() => {
        if (query === current.query) return;
        const timer = setTimeout(() => (filters.value = { ...filters.value, query }), 120);
        return () => clearTimeout(timer);
    }, [query]);

    // With the controls folded, the title row says what they are set to --
    // only what differs from the defaults, so a plain view reads as plain.
    const summary: string[] = [];
    if (current.query.trim()) summary.push(`“${current.query.trim()}”`);
    if (current.kind === "home") summary.push("Homes");
    if (current.kind === "building") summary.push("Buildings");
    if (current.source !== "all") summary.push(sourceLabel(current.source));
    if (!isDefaultSort(currentSort)) summary.push(`${SORT_LABELS[currentSort.key]} ${currentSort.dir === "asc" ? "↑" : "↓"}`);
    if (activeCount) summary.push(`${activeCount} filter${activeCount === 1 ? "" : "s"}`);
    if (photoMode.value === "strip") summary.push("Thumbnails");

    const set = (patch: Partial<typeof current>): void => {
        filters.value = { ...filters.value, ...patch };
    };
    /** Anything the Reset would undo: every filter but the search text. */
    const anySet = activeCount > 0 || current.kind !== "all" || current.source !== "all";
    const number = (value: string): number | null => {
        const n = Number(value);
        return value !== "" && Number.isFinite(n) && n >= 0 ? n : null;
    };

    return (
        <div class="filters">
            <div class="topbar">
                <button id="controls-toggle" class="disclosure" type="button" aria-expanded={open} aria-controls="controls" aria-label="Show or hide the controls" onClick={() => (controlsOpen.value = !open)} />
                <h1>Filters</h1>
                <span id="count" class="count">
                    {all === 0 ? "" : shown === all ? String(all) : `${shown} of ${all}`}
                </span>
                {/* Like the Search tab's: sets no filters, and keeps the typed text. */}
                <button id="reset-filters" class="filters-reset" type="button" title="Set no filters" hidden={!anySet} onClick={() => set({ ...DEFAULT_FILTERS, query: current.query })}>
                    Reset
                </button>
                <span id="head-summary" class="head-summary">
                    {open ? "" : summary.join(" · ")}
                </span>
            </div>
            <div id="controls" class="filters-body" hidden={!open}>
                <div class="search-row">
                    <input
                        id="search"
                        type="search"
                        placeholder="Search saved listings"
                        aria-label="Search saved listings"
                        autocomplete="off"
                        spellcheck={false}
                        value={query}
                        onInput={(event) => setQuery(event.currentTarget.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Escape" && query) {
                                event.preventDefault();
                                setQuery("");
                                set({ query: "" });
                            }
                        }}
                    />
                </div>
                <div class="controls">
                    <div class="row">
                        <span class="row-label">Show</span>
                        <div class="row-body">
                            <select id="filter" aria-label="Show" value={current.kind} onChange={(event) => set({ kind: event.currentTarget.value as typeof current.kind })}>
                                <option value="all">All</option>
                                <option value="home">Homes</option>
                                <option value="building">Buildings</option>
                            </select>
                            <select id="source-filter" aria-label="Site" value={SOURCES.some((s) => s.id === current.source) ? current.source : "all"} onChange={(event) => set({ source: event.currentTarget.value || "all" })}>
                                <option value="all">All sites</option>
                                {SOURCES.map((source) => (
                                    <option key={source.id} value={source.id}>
                                        {source.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div class="row">
                        <span class="row-label">Sort</span>
                        <div class="row-body">
                            {/* A new key starts in its natural direction; the arrow flips it from there. */}
                            <select
                                id="sort-key"
                                aria-label="Sort by"
                                value={currentSort.key}
                                onChange={(event) => {
                                    const key = event.currentTarget.value as SortKey;
                                    sort.value = { key, dir: NATURAL_DIR[key] };
                                }}
                            >
                                {SORT_KEYS.map((key) => (
                                    <option key={key} value={key}>
                                        {SORT_LABELS[key]}
                                    </option>
                                ))}
                            </select>
                            <button
                                id="sort-dir"
                                class="tool"
                                type="button"
                                aria-label={currentSort.dir === "asc" ? "Sorted ascending; click for descending" : "Sorted descending; click for ascending"}
                                onClick={() => (sort.value = { ...currentSort, dir: currentSort.dir === "asc" ? "desc" : "asc" })}
                            >
                                {currentSort.dir === "asc" ? "↑" : "↓"}
                            </button>
                        </div>
                    </div>
                    <div class="row">
                        <span class="row-label">Rent</span>
                        <div class="row-body">
                            <input id="price-min" type="number" min={0} placeholder="Min" aria-label="Minimum rent" value={current.priceMin ?? ""} onInput={(event) => set({ priceMin: number(event.currentTarget.value) })} />–
                            <input id="price-max" type="number" min={0} placeholder="Max" aria-label="Maximum rent" value={current.priceMax ?? ""} onInput={(event) => set({ priceMax: number(event.currentTarget.value) })} />
                        </div>
                    </div>
                    <div class="row">
                        <span class="row-label">Rooms</span>
                        <div class="row-body">
                            <select id="beds-min" aria-label="Minimum bedrooms" value={current.bedsMin === null ? "" : String(current.bedsMin)} onChange={(event) => set({ bedsMin: number(event.currentTarget.value) })}>
                                <option value="">Any beds</option>
                                <option value="0">Studio+</option>
                                <option value="1">1+ bd</option>
                                <option value="2">2+ bd</option>
                                <option value="3">3+ bd</option>
                                <option value="4">4+ bd</option>
                            </select>
                            <select id="baths-min" aria-label="Minimum bathrooms" value={current.bathsMin === null ? "" : String(current.bathsMin)} onChange={(event) => set({ bathsMin: number(event.currentTarget.value) })}>
                                <option value="">Any baths</option>
                                <option value="1">1+ ba</option>
                                <option value="1.5">1.5+ ba</option>
                                <option value="2">2+ ba</option>
                                <option value="3">3+ ba</option>
                            </select>
                        </div>
                    </div>
                    <div class="row">
                        <span class="row-label">Status</span>
                        <div class="row-body">
                            <select id="status-filter" aria-label="Status" value={current.status} onChange={(event) => set({ status: ((LISTING_STATUSES as readonly string[]).includes(event.currentTarget.value) ? event.currentTarget.value : "all") as ListingStatus | "all" })}>
                                <option value="all">Any status</option>
                                {LISTING_STATUSES.map((status) => (
                                    <option key={status} value={status}>
                                        {STATUS_LABELS[status]}
                                    </option>
                                ))}
                            </select>
                            <button id="clear-filters" class="tool" type="button" hidden={activeCount === 0} onClick={() => set({ ...DEFAULT_FILTERS, query: current.query, kind: current.kind, source: current.source })}>
                                Clear
                            </button>
                        </div>
                    </div>
                    <div class="row">
                        <span class="row-label">Images</span>
                        <div class="row-body">
                            <select id="photo-mode" aria-label="How an open card shows its photos" value={photoMode.value} onChange={(event) => (photoMode.value = event.currentTarget.value === "strip" ? "strip" : "carousel")}>
                                <option value="strip">Thumbnail</option>
                                <option value="carousel">Full-sized</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// The list toolbar: a master checkbox, then "Select", a menu of what to
// select; then what a selection can do; then expand and collapse all.
// ---------------------------------------------------------------------------

export function ListTools() {
    const ids = visibleIds.value;
    const n = selected.value.size;
    const all = ids.length > 0 && n === ids.length;
    const [menuOpen, setMenuOpen] = useState(false);
    const confirming = confirmingDelete.value;

    useEffect(() => {
        if (!menuOpen) return;
        const close = (): void => setMenuOpen(false);
        document.addEventListener("click", close);
        return () => document.removeEventListener("click", close);
    }, [menuOpen]);

    /** The cards the ⊞ ⊟ buttons act on: the selected ones when there is a selection, otherwise everything on screen. */
    const foldTargets = (): string[] => (n > 0 ? ids.filter((id) => selected.value.has(id)) : [...ids]);

    const remove = async (): Promise<void> => {
        const doomed = [...selected.value];
        if (doomed.length === 0) return;
        await deleteListings(doomed);
        forgetCards(doomed);
        clearSelection();
    };

    return (
        <div id="list-tools" class="list-tools">
            <span class="master">
                <input
                    id="select-master"
                    type="checkbox"
                    aria-label="Select all"
                    checked={all}
                    ref={(input) => {
                        if (input) input.indeterminate = n > 0 && !all;
                    }}
                    disabled={ids.length === 0}
                    onClick={() => (all ? clearSelection() : selectAllVisible())}
                />
                <button
                    id="select-menu-button"
                    class="menu-button"
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={(event) => {
                        event.stopPropagation();
                        setMenuOpen(!menuOpen);
                    }}
                >
                    Select
                </button>
                <div
                    id="select-menu"
                    class="menu"
                    role="menu"
                    hidden={!menuOpen}
                    onClick={(event) => {
                        const choice = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-select]")?.dataset["select"];
                        setMenuOpen(false);
                        if (choice) selectWhere(choice, new Map(ordered.value.map((listing) => [listing.id, listing])));
                    }}
                >
                    <button type="button" role="menuitem" data-select="all">All</button>
                    <button type="button" role="menuitem" data-select="none">None</button>
                    <button type="button" role="menuitem" data-select="home">Homes</button>
                    <button type="button" role="menuitem" data-select="building">Buildings</button>
                    {LISTING_STATUSES.map((status) => (
                        <button key={status} type="button" role="menuitem" data-select={`status:${status}`}>
                            {STATUS_LABELS[status]}
                        </button>
                    ))}
                </div>
            </span>
            <span id="selected-count" class="count" hidden={n === 0}>
                {`${n} ${n === 1 ? "entry" : "entries"}`}
            </span>
            <button id="delete-selected" class="tool danger" type="button" hidden={n === 0} onClick={() => (confirmingDelete.value = true)}>
                Delete
            </button>
            <span class="push" />
            <button id="expand-all" class="tool icon" type="button" aria-label="Expand all cards" title="Expand all cards" onClick={() => setCardsOpen(foldTargets(), true, SECTION_NAMES)}>
                ⊞
            </button>
            <button id="collapse-all" class="tool icon" type="button" aria-label="Collapse all cards" title="Collapse all cards" onClick={() => setCardsOpen(foldTargets(), false, SECTION_NAMES)}>
                ⊟
            </button>
            <div id="confirm" class="confirm" hidden={!confirming || n === 0}>
                <span id="confirm-text">{`Delete ${plural(n, "listing")}? This also removes their photos and history.`}</span>
                <button class="tool danger" type="button" data-action="confirm-delete" onClick={() => void remove()}>
                    Delete
                </button>
                <button class="tool" type="button" data-action="cancel-delete" onClick={() => (confirmingDelete.value = false)}>
                    Keep
                </button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export function ListingList({ onJump }: { onJump(id: string): void }) {
    const listings = ordered.value;
    const all = everything.value;
    const settings = liveSettings.value;
    const rel = relations.value;
    const activeId = activeListing.value?.id ?? null;
    const loaded = everything.value.length > 0 || all !== null;

    // What is on screen, for shift-ranges and select-all; a selection only ever covers what is on screen.
    const ids = listings.map((listing) => listing.id);
    const key = ids.join("\n");
    useEffect(() => {
        visibleIds.value = ids;
        pruneSelection(new Set(ids));
    }, [key]);
    void anchorId;

    if (!loaded) return <p class="empty">Loading…</p>;
    if (listings.length === 0) {
        if (all.length > 0) {
            return (
                <p class="empty">
                    No listings match.{" "}
                    <button type="button" class="tool" data-action="clear-filters" onClick={resetFilters}>
                        Clear search and filters
                    </button>
                </p>
            );
        }
        return <p class="empty">{enabledSources.value.size === 0 ? "No listings yet. Enable a site under Sources, open a listing there, and click Add listing above." : "No listings yet. Open a listing on an enabled site and click Add listing above."}</p>;
    }
    return (
        <>
            {listings.map((listing) => (
                <Card key={listing.id} listing={listing} isActive={listing.id === activeId} settings={settings} relations={rel} onJump={onJump} />
            ))}
        </>
    );
}
