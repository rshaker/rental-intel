import "./SourcesPane.css";
import { useSignal } from "@preact/signals";
import { SOURCES } from "../../sources";
import type { SourceDescriptor } from "../../sources/contract";
import { plural } from "../format";
import { enabledSources, grantNotes, toggleSource } from "../grants";
import { liveListings } from "../live";

/**
 * The Sources tab: one row per site the extension knows, with a switch.
 * The grants and the counts are signals, so the rows follow a change made
 * anywhere: this tab, chrome://extensions, a save in another window.
 */
export function SourcesPane() {
    const enabled = enabledSources.value;
    const notes = grantNotes.value;
    const busy = useSignal<ReadonlySet<string>>(new Set());
    const counts = new Map<string, number>();
    for (const listing of liveListings.value ?? []) counts.set(listing.source, (counts.get(listing.source) ?? 0) + 1);

    const toggle = async (source: SourceDescriptor): Promise<void> => {
        busy.value = new Set([...busy.value, source.id]);
        try {
            await toggleSource(source);
        } finally {
            busy.value = new Set([...busy.value].filter((id) => id !== source.id));
        }
    };

    return (
        <>
            <p class="hint">Each site is off until you enable it here. Enabling asks Chrome for access to that site only; the extension then recognises listings there and can fetch their photos.</p>
            {SOURCES.length === 0 ? (
                <p class="empty">This build carries no sites.</p>
            ) : (
                <ul class="source-list">
                    {SOURCES.map((source) => {
                        const on = enabled.has(source.id);
                        const saved = counts.get(source.id) ?? 0;
                        const note = notes.get(source.id);
                        return (
                            <li key={source.id} class={`source-row${on ? " enabled" : ""}`} data-source={source.id}>
                                <div class="source-head">
                                    <span class="source-name">{source.label}</span>
                                    <a class="source-home" href={source.homepage} target="_blank" rel="noreferrer">
                                        {new URL(source.homepage).hostname}
                                    </a>
                                    <span class="push" />
                                    <button type="button" class={`tool${on ? "" : " primary"}`} data-action="toggle" aria-pressed={on} disabled={busy.value.has(source.id)} onClick={() => void toggle(source)}>
                                        {on ? "Disable" : "Enable"}
                                    </button>
                                </div>
                                <p class="source-facts">{[on ? "Enabled" : "Off", saved ? `${plural(saved, "listing")} saved` : "nothing saved yet", `checked against the site ${source.verifiedOn}`].join(" · ")}</p>
                                {note && <p class="source-note">{note}</p>}
                            </li>
                        );
                    })}
                </ul>
            )}
        </>
    );
}
