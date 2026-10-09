import "./SearchPane.css";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { SOURCES } from "../../sources";
import type { SearchFilterField, SourceDescriptor } from "../../sources/contract";
import { plural } from "../format";
import { isEnabled } from "../grants";
import { saveTextAs, URL_LIST } from "../saveFile";
import { parseSearchStates, type SiteSearchState } from "../schemas";
import { runSearch } from "../search/runSearch";
import { readStored, store } from "../store";
import { CurrentTabLink } from "./links";

/**
 * The Search tab: one form per site that can be searched, each a single
 * text field. A run opens the site's results page in the tab beside the
 * panel and lists what the site's content script reads off it
 * (search/runSearch.ts); each result is a link that sends that tab on to
 * the listing, the way every other web link in the panel does.
 *
 * Results are links and nothing more: saving one is a visit to its page and
 * the capture button, as for any page; "Add to listings" hands the whole
 * list to the Load URLs dialog, which does that visit for each. The list
 * can be folded away under its status line, and its URLs saved to a text
 * file, one per line, which is the shape Load URLs reads. The Listings
 * tab's own search box is a different thing -- it searches what is saved.
 *
 * Under the text field, a site that takes filters has them folded behind
 * "+ Filters": one line per group (rent, rooms, pets, ...), each field one
 * the source declares because its URL spelling is known. They shape the
 * next run; the runner applies them once the site has found the place.
 *
 * What each form last did -- the text, the filters, the status, the results
 * -- is kept in localStorage, so it is there again when the panel is
 * reopened and in every panel document (the panel is per tab); each one
 * reads the latest on `storage`, except for a form it is running itself.
 */

const KEY = "intel.panel.search";

export interface SearchPaneProps {
    /** A line for the activity log: what a run came to. */
    onLine?(text: string, tone: "" | "good" | "bad" | "dim"): void;
    /** Hands a list of listing URLs, one per line, to the Load URLs dialog. */
    onLoad?(urls: string): void;
}

const FRESH: SiteSearchState = { query: "", status: "", tone: "", results: null, resultsUrl: null, collapsed: false, filters: {}, filtersOpen: false };

/** A form's filters less any its source no longer offers: a stored value from an older build. */
function known(source: SourceDescriptor, filters: SiteSearchState["filters"]): SiteSearchState["filters"] {
    const keys = new Set((source.search?.filters ?? []).map((field) => field.key));
    return Object.fromEntries(Object.entries(filters).filter(([key]) => keys.has(key)));
}

/** A source's filter fields in their groups, in the order the source lists them. */
function grouped(fields: readonly SearchFilterField[]): Map<string, SearchFilterField[]> {
    const groups = new Map<string, SearchFilterField[]>();
    for (const field of fields) groups.set(field.group, [...(groups.get(field.group) ?? []), field]);
    return groups;
}

export function SearchPane({ onLine, onLoad }: SearchPaneProps) {
    const searchable = SOURCES.filter((source) => source.search);
    const states = useSignal<ReadonlyMap<string, SiteSearchState>>(parseSearchStates(readStored(KEY)));
    /** The runs in progress, by source id. Not stored: they belong to this document. */
    const controllers = useRef(new Map<string, AbortController>());
    const running = useSignal<ReadonlySet<string>>(new Set());

    const stateOf = (source: SourceDescriptor): SiteSearchState => {
        const state = states.value.get(source.id) ?? FRESH;
        return Object.keys(state.filters).length ? { ...state, filters: known(source, state.filters) } : state;
    };

    /** Changes one form's state and writes every form's. */
    const update = (source: SourceDescriptor, patch: Partial<SiteSearchState>, save = true): void => {
        const next = new Map(states.value);
        next.set(source.id, { ...stateOf(source), ...patch });
        states.value = next;
        if (save) store(KEY, JSON.stringify(Object.fromEntries(next)));
    };

    // Another panel document wrote: take its word for every form not running here.
    useEffect(() => {
        const onStorage = (event: StorageEvent): void => {
            if (event.key !== KEY) return;
            const stored = parseSearchStates(event.newValue);
            const next = new Map(stored);
            for (const id of controllers.current.keys()) {
                const mine = states.value.get(id);
                if (mine) next.set(id, mine);
            }
            states.value = next;
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, []);

    const start = async (source: SourceDescriptor): Promise<void> => {
        if (controllers.current.has(source.id)) return;
        const query = stateOf(source).query.trim();
        if (!query) return;
        const controller = new AbortController();
        controllers.current.set(source.id, controller);
        running.value = new Set([...running.value, source.id]);
        update(source, { results: null, resultsUrl: null, collapsed: false, tone: "", status: "Searching…" }, false);

        const outcome = await runSearch(source, query, {
            signal: controller.signal,
            onStatus: (text) => update(source, { status: text }, false),
            onLine: (text) => onLine?.(text, "dim"),
            filters: stateOf(source).filters,
        });

        controllers.current.delete(source.id);
        running.value = new Set([...running.value].filter((id) => id !== source.id));
        if (outcome.ok) {
            let status = outcome.results.length ? plural(outcome.results.length, "result") : "No results.";
            if (outcome.pages > 1) status += ` from ${outcome.pages} pages`;
            if (outcome.stopped) status += `; stopped early (${outcome.stopped})`;
            update(source, { results: outcome.results, resultsUrl: outcome.url, status });
            onLine?.(`${source.label} search “${query}”: ${status.toLowerCase().replace(/\.$/, "")}`, outcome.results.length ? "good" : "dim");
        } else {
            const status = {
                "no-url": `That text cannot be turned into a ${source.label} search. Try a city or neighbourhood, or paste a search URL from the site.`,
                failed: outcome.reason === "failed" ? outcome.message : "",
                cancelled: "Cancelled.",
                closed: "The search tab was closed before it answered.",
            }[outcome.reason];
            update(source, { tone: outcome.reason === "cancelled" ? "" : "bad", status });
            onLine?.(`${source.label} search “${query}”: ${outcome.reason === "cancelled" ? "cancelled" : "failed, " + outcome.reason}`, outcome.reason === "cancelled" ? "dim" : "bad");
        }
    };

    /** The results' URLs, one per line: what Load URLs reads. */
    const urlList = (source: SourceDescriptor): string => (stateOf(source).results ?? []).map((result) => `${result.url}\n`).join("");

    /** Saves the results' URLs to a text file the user names and places. */
    const saveUrls = async (source: SourceDescriptor): Promise<void> => {
        const state = stateOf(source);
        const count = state.results?.length ?? 0;
        if (!count) return;
        const slug = state.query.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
        const name = `${source.id}-search${slug ? `-${slug}` : ""}.txt`;
        try {
            const outcome = await saveTextAs(name, async () => urlList(source), URL_LIST);
            if (outcome !== "cancelled") onLine?.(`${source.label} search: ${plural(count, "URL")} saved to ${name}${outcome === "downloaded" ? " in the downloads folder" : ""}`, "good");
        } catch (error) {
            onLine?.(`${source.label} search: saving the URLs failed: ${error instanceof Error ? error.message : String(error)}`, "bad");
        }
    };

    /** One filter's value, from its control; an emptied or unticked one is forgotten. */
    const setFilter = (source: SourceDescriptor, field: SearchFilterField, control: HTMLInputElement | HTMLSelectElement): void => {
        const value = field.kind === "flag" ? (control as HTMLInputElement).checked : field.kind === "text" ? control.value.trim() : Number(control.value);
        const filters = { ...stateOf(source).filters };
        if (value === true || (typeof value === "number" && Number.isFinite(value) && value > 0) || (typeof value === "string" && value)) filters[field.key] = value;
        else delete filters[field.key];
        update(source, { filters });
    };

    return (
        <>
            <p class="hint">Searches a site in this tab and lists what it finds; the tab is left on the results page. Click a result to open it here.</p>
            {searchable.length === 0 ? (
                <p class="empty">No site in this build can be searched.</p>
            ) : (
                <ul class="source-list">
                    {searchable.map((source) => {
                        const state = stateOf(source);
                        const enabled = isEnabled(source);
                        const isRunning = running.value.has(source.id);
                        const fields = source.search?.filters ?? [];
                        const filterCount = Object.keys(state.filters).length;
                        return (
                            <li key={source.id} class={`source-row search-row${enabled ? " enabled" : ""}${isRunning ? " running" : ""}`} data-source={source.id}>
                                <div class="source-head">
                                    <span class="source-name">{source.label}</span>
                                    <a class="source-home" href={source.homepage} target="_blank" rel="noreferrer">
                                        {new URL(source.homepage).hostname}
                                    </a>
                                </div>
                                <form
                                    class="search-form"
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        if (isRunning) controllers.current.get(source.id)?.abort();
                                        else void start(source);
                                    }}
                                >
                                    <input
                                        type="search"
                                        placeholder="City, neighbourhood or address, or paste a search URL"
                                        aria-label={`Search ${source.label}`}
                                        autocomplete="off"
                                        spellcheck={false}
                                        disabled={!enabled}
                                        readOnly={isRunning}
                                        value={state.query}
                                        onInput={(event) => update(source, { query: event.currentTarget.value }, false)}
                                        onChange={() => update(source, {})}
                                    />
                                    <button type="submit" class="tool" disabled={!enabled} data-action={isRunning ? "cancel" : "run"}>
                                        {isRunning ? "Cancel" : "Search"}
                                    </button>
                                </form>
                                {fields.length > 0 && (
                                    <>
                                        <div class="search-filters-head">
                                            <Action class="search-filters-toggle" title="Show or hide the filters" onClick={() => update(source, { filtersOpen: !state.filtersOpen })} expanded={state.filtersOpen}>
                                                {`${state.filtersOpen ? "−" : "+"} Filters${filterCount ? ` (${filterCount})` : ""}`}
                                            </Action>
                                            <Action class="search-filters-reset" title="Set no filters" hidden={filterCount === 0 || isRunning} onClick={() => update(source, { filters: {} })}>
                                                Reset
                                            </Action>
                                        </div>
                                        <div class="search-filters" hidden={!state.filtersOpen}>
                                            {[...grouped(fields)].map(([group, members]) => (
                                                <div key={group} class="search-filter-row">
                                                    <span class="search-filter-label">{group}</span>
                                                    <div class={members.every((field) => field.kind === "flag") ? "search-checks" : "search-fields"}>
                                                        {members.map((field) => (
                                                            <FilterControl key={field.key} field={field} group={group} value={state.filters[field.key]} disabled={!enabled || isRunning} onChange={(control) => setFilter(source, field, control)} />
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                            <p class="hint">Applied on the site once it has found the place. A pasted URL is used as it is.</p>
                                        </div>
                                    </>
                                )}
                                <p class={`search-status${state.tone ? ` ${state.tone}` : ""}`} role="status">
                                    {!enabled ? (
                                        "Enable it on the Sources tab."
                                    ) : (
                                        <>
                                            {state.results?.length && !isRunning ? (
                                                <button type="button" class="search-fold" aria-expanded={!state.collapsed} aria-label="Show or hide the results" onClick={() => update(source, { collapsed: !state.collapsed })}>
                                                    {state.collapsed ? "+" : "−"}
                                                </button>
                                            ) : null}
                                            {state.status}
                                            {state.resultsUrl && !isRunning && (
                                                <>
                                                    {" · "}
                                                    <CurrentTabLink href={state.resultsUrl} title={state.resultsUrl}>
                                                        results page
                                                    </CurrentTabLink>
                                                </>
                                            )}
                                            {state.results?.length && !isRunning ? (
                                                <>
                                                    {" · "}
                                                    <Action class="search-toggle" title={state.collapsed ? "Show the list of results" : "Fold the list of results away"} onClick={() => update(source, { collapsed: !state.collapsed })}>
                                                        {state.collapsed ? "Show" : "Hide"}
                                                    </Action>
                                                    {" · "}
                                                    <Action class="search-save" title="Save the results' URLs to a text file, one per line" onClick={() => void saveUrls(source)}>
                                                        Save URLs
                                                    </Action>
                                                    {onLoad && (
                                                        <>
                                                            {" · "}
                                                            <Action class="search-load" title="Load every result's page and save it, through Load URLs; listings already saved are skipped" onClick={() => onLoad(urlList(source))}>
                                                                Add to listings
                                                            </Action>
                                                        </>
                                                    )}
                                                </>
                                            ) : null}
                                            {(state.results || state.status) && !isRunning && (
                                                <>
                                                    {" · "}
                                                    <Action class="search-clear" title="Forget these results; the text stays" onClick={() => update(source, { results: null, resultsUrl: null, collapsed: false, status: "", tone: "" })}>
                                                        Clear
                                                    </Action>
                                                </>
                                            )}
                                        </>
                                    )}
                                </p>
                                <ol class="search-results" hidden={!state.results?.length || isRunning || state.collapsed}>
                                    {(state.results ?? []).map((result) => {
                                        const facts = [result.priceText, result.factsText].filter(Boolean).join(" · ");
                                        return (
                                            <li key={result.url}>
                                                <CurrentTabLink href={result.url} title={result.url}>
                                                    {result.title}
                                                </CurrentTabLink>
                                                {facts && (
                                                    <>
                                                        {" "}
                                                        <span class="search-facts">{facts}</span>
                                                    </>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ol>
                            </li>
                        );
                    })}
                </ul>
            )}
        </>
    );
}

/** A button that sits in the status line as a link would. */
function Action({ class: className, title, hidden, expanded, onClick, children }: { class: string; title: string; hidden?: boolean; expanded?: boolean; onClick(): void; children: preact.ComponentChildren }) {
    return (
        <button type="button" class={`search-action ${className}`} title={title} hidden={hidden} aria-expanded={expanded} onClick={onClick}>
            {children}
        </button>
    );
}

interface FilterControlProps {
    field: SearchFilterField;
    group: string;
    value: number | boolean | string | undefined;
    disabled: boolean;
    onChange(control: HTMLInputElement | HTMLSelectElement): void;
}

function FilterControl({ field, group, value, disabled, onChange }: FilterControlProps) {
    const name = field.label === group ? field.label : `${group}: ${field.title ?? field.label}`;
    if (field.kind === "least") {
        return (
            <label>
                {field.label}
                <select data-filter={field.key} aria-label={name} disabled={disabled} value={typeof value === "number" ? String(value) : ""} onChange={(event) => onChange(event.currentTarget)}>
                    <option value="">Any</option>
                    {(field.steps ?? []).map((step) => (
                        <option key={step} value={String(step)}>{`${step}+`}</option>
                    ))}
                </select>
            </label>
        );
    }
    if (field.kind === "flag") {
        return (
            <label title={field.title ?? ""}>
                <input type="checkbox" data-filter={field.key} disabled={disabled} checked={value === true} onChange={(event) => onChange(event.currentTarget)} />
                <span>{field.label}</span>
            </label>
        );
    }
    const shared = {
        "data-filter": field.key,
        placeholder: field.label === group ? (field.title ?? "") : field.label,
        title: field.title ?? "",
        "aria-label": name,
        disabled,
        value: typeof value === "number" || typeof value === "string" ? String(value) : "",
        onChange: (event: { currentTarget: HTMLInputElement }) => onChange(event.currentTarget),
    };
    return field.kind === "amount" ? <input type="number" min={0} {...shared} /> : <input type="text" spellcheck={false} {...shared} />;
}
