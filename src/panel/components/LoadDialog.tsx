import { signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { findByRef } from "../../db/listings";
import { displayName } from "../../db/types";
import type { SourceDescriptor } from "../../sources/contract";
import { plural } from "../format";
import { BulkControl, runBulkLoad, type BulkEvent, type BulkProgress } from "../bulk/bulkLoad";
import { parseUrlList, type UrlEntry } from "../bulk/urlList";
import "./LoadDialog.css";

/**
 * The "Load URLs" dialog: paste or choose a list, check it, run it, watch it.
 *
 * A native <dialog>, shown modally, so a run in progress cannot be tripped
 * over by an import or a clear-all from the row behind it. The log keeps
 * everything said since the panel opened -- one line per listing, plus the
 * plan of each run -- because a run of fifty pages takes minutes and the
 * question afterwards is always "which ones didn't make it".
 *
 * Phases, each with its own set of buttons:
 *   compose  the textarea, a file button that appends into it, "Check list"
 *   ready    the plan is in the log; Start or Back
 *   running  Pause and Cancel; while the run waits on the person at the
 *            tab (a page that has not confirmed in its budget), Retry, Skip
 *            and Cancel
 *   paused   Resume and Cancel
 *   done     Load more or Close
 *
 * Escape closes the dialog only when nothing is running.
 */

type Phase = "compose" | "ready" | "running" | "paused" | "done";
type Tone = "" | "good" | "bad" | "dim";

interface Plan {
    entries: UrlEntry[];
}

const BUTTONS: Record<Phase, string[]> = {
    compose: ["file", "check", "clear-log", "close"],
    ready: ["start", "back"],
    running: ["pause", "cancel"],
    paused: ["resume", "cancel"],
    done: ["more", "clear-log", "close"],
};

/** The last request to open the dialog, from the Data tab or the Search tab. */
const requests = signal<{ seq: number; urls?: string } | null>(null);
let sequence = 0;

/** Opens the dialog. With `urls` -- a list from elsewhere in the panel -- the list is put in and checked, ready for Start. A run in progress is left alone. */
export function openLoadDialog(urls?: string): void {
    requests.value = { seq: ++sequence, urls };
}

export interface LoadDialogProps {
    /** A one-line summary for the panel's status text when a run ends. */
    onStatus(text: string): void;
    /** Every line of the dialog's transcript, for a log that outlives the dialog. */
    onLine?(text: string, tone: Tone): void;
    /** Which sources the user has enabled: only their URLs can be loaded. */
    isEnabled(source: SourceDescriptor): boolean;
}

export function LoadDialog({ onStatus, onLine, isEnabled }: LoadDialogProps) {
    const dialog = useRef<HTMLDialogElement>(null);
    const textarea = useRef<HTMLTextAreaElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const logList = useRef<HTMLOListElement>(null);
    const [phase, setPhase] = useState<Phase>("compose");
    const [text, setText] = useState("");
    const [log, setLog] = useState<{ text: string; tone: Tone }[]>([]);
    /** Pause was asked for; the run parks after the listing in flight. */
    const [pausing, setPausing] = useState(false);
    /** The run is waiting on the person at the tab; Skip gives up on the listing in flight. */
    const [waiting, setWaiting] = useState(false);
    const plan = useRef<Plan | null>(null);
    const control = useRef<BulkControl | null>(null);

    const say = (message: string, tone: Tone = ""): void => {
        setLog((lines) => [...lines, { text: message, tone }]);
        onLine?.(message, tone);
    };

    useEffect(() => {
        logList.current?.scrollTo(0, logList.current.scrollHeight);
    }, [log]);

    const show = (): void => {
        if (!dialog.current?.open) dialog.current?.showModal();
    };

    // -- compose -> ready ---------------------------------------------------

    /**
     * Listings already in the database are left out: the point of a list is to
     * get a shortlist in, not to re-visit fifty pages for a price check. Re-save
     * one from its own page when it matters.
     */
    const check = async (list: string): Promise<void> => {
        const parsed = parseUrlList(list, isEnabled);
        const entries: UrlEntry[] = [];
        for (const entry of parsed.entries) {
            if (await findByRef(entry.ref)) continue;
            entries.push(entry);
        }
        say(`Checked list at ${new Date().toLocaleTimeString()}.`, "dim");
        for (const line of parsed.skipped) say(`Not a listing URL: ${line}`, "bad");
        for (const { line, source } of parsed.disabled) say(`${source} is not enabled (Sources tab): ${line}`, "bad");
        if (parsed.duplicates) say(`${plural(parsed.duplicates, "duplicate line")} ignored.`, "dim");
        const alreadySaved = parsed.entries.length - entries.length;
        if (alreadySaved) say(`${plural(alreadySaved, "listing")} already saved, skipped.`, "dim");

        if (entries.length === 0) {
            say(parsed.entries.length === 0 ? "Nothing to load: no listing URLs of an enabled site found." : "Nothing to load: every listing is already saved.");
            plan.current = null;
            setPhase("compose");
            return;
        }
        const sites = new Map<string, number>();
        for (const entry of entries) sites.set(entry.ref.source, (sites.get(entry.ref.source) ?? 0) + 1);
        const bySite = [...sites].map(([source, n]) => `${n} from ${source}`).join(", ");
        say(`Ready to load ${plural(entries.length, "listing")} (${bySite}) in the tab beside the panel, one at a time.`);
        plan.current = { entries };
        setPhase("ready");
    };

    // The requests to open, from elsewhere in the panel.
    const request = requests.value;
    useEffect(() => {
        if (!request) return;
        if (request.urls !== undefined && control.current === null) {
            plan.current = null;
            setText(request.urls);
            setPhase("compose");
            show();
            void check(request.urls);
            return;
        }
        if (control.current === null) setPhase(plan.current ? "ready" : "compose");
        show();
        if (control.current === null && !plan.current) setTimeout(() => textarea.current?.focus(), 0);
    }, [request?.seq]);

    // -- ready -> running -> done -------------------------------------------

    const summary = (progress: BulkProgress): string => {
        const counts = [progress.saved ? `${progress.saved} saved` : "", progress.unchanged ? `${progress.unchanged} unchanged` : "", progress.failed.length ? `${progress.failed.length} failed` : ""].filter(Boolean).join(", ");
        const ending = progress.stopped === "cancelled" ? " Cancelled." : progress.stopped === "failures" ? " Stopped after repeated failures." : "";
        return `Loaded ${progress.done} of ${progress.total}.${counts ? ` ${counts}.` : ""}${ending}`;
    };

    /** One log line per event. Saved listings are named, which needs the database. */
    const describe = async (event: BulkEvent, progress: BulkProgress): Promise<void> => {
        switch (event.type) {
            case "loading":
                setWaiting(false);
                say(`${event.index + 1}/${progress.total}  ${event.entry.url}`);
                return;
            case "waiting":
                setWaiting(true);
                say(`Waiting on the tab: ${event.reason}. Answer any check the site shows there, Retry the page, or Skip it.`, "dim");
                return;
            case "retrying":
                setWaiting(false);
                say("Retrying.", "dim");
                return;
            case "result": {
                if (event.outcome === "failed") {
                    say(`    failed: ${event.reason}`, "bad");
                    return;
                }
                const listing = await findByRef(event.ref);
                say(`    ${event.outcome === "saved" ? "saved" : "unchanged"}: ${listing ? displayName(listing) : event.ref.sourceId}`, "good");
                return;
            }
            case "paused":
                say("Paused.", "dim");
                setPhase("paused");
                return;
            case "resumed":
                say("Resumed.", "dim");
                setPhase("running");
                return;
            case "done":
                say(summary(progress), progress.failed.length ? "bad" : "good");
                if (progress.stopped === "failures") say("Look at the loading tab -- the site may be asking you to prove you are a person.", "bad");
                return;
        }
    };

    const start = async (): Promise<void> => {
        if (!plan.current) return;
        const { entries } = plan.current;
        plan.current = null;
        control.current = new BulkControl();
        setPausing(false);
        setPhase("running");
        say(`Started at ${new Date().toLocaleTimeString()}.`, "dim");
        let last: BulkProgress | null = null;
        try {
            last = await runBulkLoad(entries, {
                control: control.current,
                onEvent: (event, progress) => {
                    last = progress;
                    void describe(event, progress);
                },
            });
        } catch (error) {
            say(`Load failed: ${error instanceof Error ? error.message : String(error)}`, "bad");
        } finally {
            control.current = null;
            setPausing(false);
            setWaiting(false);
            setPhase("done");
            if (last) onStatus(summary(last));
        }
    };

    const act = (action: string): void => {
        switch (action) {
            case "file":
                fileInput.current?.click();
                break;
            case "check":
                void check(text);
                break;
            case "start":
                void start();
                break;
            case "back":
                plan.current = null;
                setPhase("compose");
                break;
            case "pause":
                // Takes effect once the listing in flight is finished; the log says "Paused." when the run has actually parked.
                control.current?.pause();
                say("Pausing after the current listing…", "dim");
                setPausing(true);
                break;
            case "resume":
                if (control.current?.paused) {
                    control.current.resume();
                    // Resumed before it ever parked: no "Resumed." will come.
                    if (phase === "running") say("Carrying on.", "dim");
                }
                setPausing(false);
                break;
            case "skip":
                control.current?.skip();
                break;
            case "retry":
                control.current?.retry();
                break;
            case "cancel":
                control.current?.cancel();
                break;
            case "more":
                setText("");
                setPhase("compose");
                setTimeout(() => textarea.current?.focus(), 0);
                break;
            case "clear-log":
                setLog([]);
                break;
            case "close":
                dialog.current?.close();
                break;
        }
    };

    const visible = (action: string): boolean => {
        if (action === "pause") return phase === "running" && !pausing && !waiting;
        if (action === "resume") return phase === "paused" || (phase === "running" && pausing);
        if (action === "skip" || action === "retry") return phase === "running" && waiting;
        return BUTTONS[phase].includes(action);
    };

    return (
        <dialog
            id="load-dialog"
            class="load-dialog"
            ref={dialog}
            aria-labelledby="load-title"
            // Escape must not abandon a run; the buttons are how it stops.
            onCancel={(event) => {
                if (control.current !== null) event.preventDefault();
            }}
        >
            <h2 id="load-title">Load listings</h2>
            <p class="hint" id="load-hint">
                Listing URLs from an enabled site, one per line. Blank lines and lines starting with # are ignored.
            </p>
            <textarea id="load-text" ref={textarea} aria-label="Listing URLs" placeholder="https://…" spellcheck={false} hidden={phase !== "compose"} value={text} onInput={(event) => setText(event.currentTarget.value)} />
            <input
                id="load-file"
                ref={fileInput}
                type="file"
                accept="text/plain,.txt"
                hidden
                onChange={(event) => {
                    const chosen = event.currentTarget.files?.[0];
                    const input = event.currentTarget;
                    if (!chosen) return;
                    void chosen.text().then((contents) => {
                        setText((current) => (current && !current.endsWith("\n") ? `${current}\n${contents}` : current + contents));
                        input.value = ""; // so the same file can be chosen again
                        textarea.current?.focus();
                    });
                }}
            />
            <ol id="load-log" class="load-log" ref={logList} aria-label="Log" aria-live="polite" hidden={phase === "compose" && log.length === 0}>
                {log.map((line, i) => (
                    <li key={i} class={line.tone || undefined}>
                        {line.text}
                    </li>
                ))}
            </ol>
            <div id="load-buttons" class="dialog-buttons">
                {(
                    [
                        ["file", "Choose file…", "tool"],
                        ["check", "Check list", "tool"],
                        ["start", "Start", "tool"],
                        ["back", "Back", "tool"],
                        ["pause", "Pause", "tool"],
                        ["resume", "Resume", "tool"],
                        ["retry", "Retry", "tool"],
                        ["skip", "Skip", "tool"],
                        ["cancel", "Cancel", "tool danger"],
                        ["more", "Load more…", "tool"],
                        ["clear-log", "Clear log", "tool push"],
                        ["close", "Close", "tool"],
                    ] as const
                ).map(([action, label, className]) => (
                    <button key={action} class={className} type="button" data-action={action} hidden={!visible(action)} onClick={() => act(action)}>
                        {label}
                    </button>
                ))}
            </div>
        </dialog>
    );
}
