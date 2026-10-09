import type { LogLine } from "./messages";

/**
 * Warnings and errors: to the console, and to the panel's activity log so a
 * problem on a listing page or in the worker is visible without DevTools.
 * The panel sets a sink that appends to the log; the worker and the content
 * scripts forward by message.
 */

type Level = "warn" | "error";
type Sink = (level: Level, text: string) => void;

let sink: Sink | null = null;

export function setLogSink(next: Sink | null): void {
    sink = next;
}

/** Forwards this context's warnings and errors to the extension pages, best effort. `context` names it in the log: "worker", "zillow.com". */
export function forwardLogTo(context: string): void {
    setLogSink((level, text) => {
        const line: LogLine = { type: "log-line", level, context, text };
        try {
            void chrome.runtime.sendMessage(line).catch(() => undefined);
        } catch {
            // No runtime here, or not any more.
        }
    });
}

export function warn(...args: unknown[]): void {
    emit("warn", args);
}

export function error(...args: unknown[]): void {
    emit("error", args);
}

function emit(level: Level, args: unknown[]): void {
    (level === "error" ? console.error : console.warn)(...args);
    if (!sink) return;
    try {
        sink(level, args.map(text).join(" "));
    } catch {
        // A sink must never take the logger down with it.
    }
}

function text(arg: unknown): string {
    if (arg instanceof Error) return arg.message;
    if (typeof arg === "string") return arg;
    if (arg === undefined || arg === null || typeof arg !== "object") return String(arg);
    try {
        const json = JSON.stringify(arg);
        return json.length > 200 ? `${json.slice(0, 199)}…` : json;
    } catch {
        return String(arg);
    }
}
