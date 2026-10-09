import "./SearchPane.css";
import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { SOURCES } from "../../sources";
import type { SearchFilterField, SearchResult, SourceDescriptor } from "../../sources/contract";
import { FILTERS, grouped } from "../../sources/shared/filters";
import { plural } from "../format";
import { isEnabled } from "../grants";
import { saveTextAs, URL_LIST } from "../saveFile";
import { parseSearchStates, type SiteSearchState } from "../schemas";
import { runSearch } from "../search/runSearch";
import { readStored, store } from "../store";
import { CurrentTabLink } from "./links";

/**
 * The Search tab: one form per searchable site. A run opens the site's
 * results in the active tab (search/runSearch.ts) and lists them as links;
 * "Add to listings" hands the list to Load URLs. Filters fold behind
 * "+ Filters"; once a site has answered, "Show" narrows the list to the
 * homes or the buildings among the results, and the save and load actions
 * take what is shown. Each form's last state is kept in localStorage and
 * shared between panel windows through the `storage` event.
 */

const KEY = "intel.panel.search";

export interface SearchPaneProps {
    /** A line for the activity log: what a run came to. */
    onLine?(text: string, tone: "" | "good" | "bad" | "dim"): void;
    /** Hands a list of listing URLs, one per line, to the Load URLs dialog. */
    onLoad?(urls: string): void;
}

const FRESH: SiteSearchState = { query: "", status: "", tone: "", results: null, resultsUrl: null, collapsed: false, filters: {}, filtersOpen: false, show: "all" };

/** A form's filters less any its source no longer offers: a stored value from an older build. */
function known(source: SourceDescriptor, filters: SiteSearchState["filters"]): SiteSearchState["filters"] {
    const keys = new Set((source.search?.filters ?? []).map((field) => field.key));
    return Object.fromEntries(Object.entries(filters).filter(([key]) => keys.has(key)));
}

/** The shared filters this source has no spelling for, by label, in vocabulary order: what the form's footnote names. */
function notOffered(source: SourceDescriptor): string[] {
    const has = new Set((source.search?.filters ?? []).map((field) => field.key));
    return FILTERS.filter((field) => !has.has(field.key)).map((field) => field.label);
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

    // Another panel window wrote: take its word for every form not running here.
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

    /** The results the form lists: every one, or those of the kind "Show" is set to. */
    const shown = (source: SourceDescriptor): SearchResult[] => {
        const state = stateOf(source);
        const results = state.results ?? [];
        return state.show === "all" ? results : results.filter((result) => result.kind === state.show);
    };

    /** The shown results' URLs, one per line: what Load URLs reads. */
    const urlList = (source: SourceDescriptor): string => shown(source).map((result) => `${result.url}\n`).join("");

    /** Saves the results' URLs to a text file the user names and places. */
    const saveUrls = async (source: SourceDescriptor): Promise<void> => {
        const state = stateOf(source);
        const count = shown(source).length;
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

    /** One filter's value, from its control; an emptied, unticked or blank one is forgotten. */
    const setFilter = (source: SourceDescriptor, field: SearchFilterField, control: HTMLInputElement | HTMLSelectElement): void => {
        const value = field.kind === "flag" ? (control as HTMLInputElement).checked : field.kind === "text" ? control.value : Number(control.value);
        const filters = { ...stateOf(source).filters };
        if (value === true || (typeof value === "number" && Number.isFinite(value) && value > 0) || (typeof value === "string" && value.trim())) filters[field.key] = value;
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
                                            {notOffered(source).length > 0 && <p class="hint search-filters-missing">Not on {source.label}: {notOffered(source).join(", ")}.</p>}
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
                                            {state.results?.length && !isRunning && state.results.some((result) => result.kind) ? (
                                                <>
                                                    {" · "}
                                                    <label class="search-show">
                                                        Show{" "}
                                                        <select aria-label="Which of the results to list" value={state.show} onChange={(event) => update(source, { show: event.currentTarget.value as SiteSearchState["show"] })}>
                                                            <option value="all">All ({state.results.length})</option>
                                                            <option value="home">Homes ({state.results.filter((result) => result.kind === "home").length})</option>
                                                            <option value="building">Buildings ({state.results.filter((result) => result.kind === "building").length})</option>
                                                        </select>
                                                    </label>
                                                </>
                                            ) : null}
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
                                    {shown(source).map((result) => {
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
                                                {result.kind && (
                                                    <>
                                                        {" "}
                                                        <span class={`search-kind search-kind-${result.kind}`}>{result.kind === "home" ? "home" : "bldg"}</span>
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
    if (field.kind === "text") {
        return (
            <label>
                {field.label}
                <input type="text" data-filter={field.key} title={field.title ?? ""} aria-label={name} disabled={disabled} spellcheck={false} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.currentTarget)} />
            </label>
        );
    }
    if (field.kind === "minimum") {
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
    return <input type="number" min={0} data-filter={field.key} placeholder={field.label === group ? (field.title ?? "") : field.label} title={field.title ?? ""} aria-label={name} disabled={disabled} value={typeof value === "number" ? String(value) : ""} onChange={(event) => onChange(event.currentTarget)} />;
}
