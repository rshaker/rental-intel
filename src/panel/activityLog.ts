import { signal, type ReadonlySignal } from "@preact/signals";
import { readStored, store } from "./store";

/** The Data tab's activity log: one timestamped line per event, kept in localStorage, capped. */

const KEY = "intel.panel.activity";
const MAX_LINES = 400;

export type LogKind = "info" | "warn" | "error";

const MARK: Record<LogKind, string> = { info: "", warn: "⚠ ", error: "✖ " };

export interface ActivityLog {
    readonly lines: ReadonlySignal<readonly string[]>;
    /** Appends one line, stamped with the time. */
    say(text: string, kind?: LogKind): void;
    clear(): void;
    /** Every line, for copying. */
    text(): string;
}

export function createActivityLog(now: () => Date = () => new Date()): ActivityLog {
    const lines = signal<readonly string[]>(readStored(KEY)?.split("\n").filter(Boolean) ?? []);
    return {
        lines,
        say(text, kind = "info") {
            const stamp = now().toTimeString().slice(0, 8);
            const body = `${MARK[kind]}${text}`.split("\n").join("\n          ");
            const next = [...lines.value, `${stamp}  ${body}`];
            lines.value = next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
            store(KEY, lines.value.join("\n"));
        },
        clear() {
            lines.value = [];
            store(KEY, "");
        },
        text: () => lines.value.join("\n"),
    };
}

/** The panel's one log. */
export const activity = createActivityLog();
