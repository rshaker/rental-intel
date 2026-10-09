/**
 * Small console logger with the same call shape as the one in the other
 * extensions (`log(LogLevels.INFO, ...)`). Import `log` where you need it.
 *
 * Levels can be muted at runtime from any context's devtools console, via the
 * debug handle installed by lib/debug.ts -- this module's exports are not
 * globals, so `Logger` alone is not reachable there:
 *   `__intel.Logger.activeLevels = ["warn", "error"]`
 */
export const LogLevels = {
    DEBUG: "debug",
    INFO: "info",
    WARN: "warn",
    ERROR: "error",
    MSGS: "msgs", // cross-context message traffic
} as const;

export type LogLevel = (typeof LogLevels)[keyof typeof LogLevels];

const STYLES: Record<LogLevel, string> = {
    debug: "color: white; background-color: dimgray;",
    info: "color: white; background-color: royalblue;",
    warn: "color: black; background-color: gold;",
    error: "color: white; background-color: crimson;",
    msgs: "color: white; background-color: seagreen;",
};

export const Logger = {
    /**
     * Which levels actually print. Everything in a dev build; only problems in
     * a production build, so a store install has a quiet console. Mutate from
     * the console (via `__intel.Logger`) to change either way at runtime.
     */
    activeLevels: (import.meta.env.DEV ? Object.values(LogLevels) : [LogLevels.WARN, LogLevels.ERROR]) as LogLevel[],
    /** Prefix every line with a wall-clock timestamp. */
    timestamps: true,
    /**
     * Where a warning or error goes besides the console, when somewhere wants
     * it: the side panel's activity log, in the panel itself and, by message,
     * from every other context (lib/debug.ts installs that). Called after the
     * console line, never for the quieter levels.
     */
    sink: null as ((level: "warn" | "error", text: string) => void) | null,
};

function isLevel(value: unknown): value is LogLevel {
    return typeof value === "string" && value in STYLES;
}

export function log(level: LogLevel | unknown, ...args: unknown[]): void {
    const resolved: LogLevel = isLevel(level) ? level : LogLevels.INFO;
    if (!isLevel(level)) args.unshift(level);
    if (!Logger.activeLevels.includes(resolved)) return;

    const prefix = Logger.timestamps ? [new Date().toISOString().slice(11, 23)] : [];
    const method = resolved === "error" ? console.error : resolved === "warn" ? console.warn : console.log;
    method(`%c${resolved}`, STYLES[resolved], ...prefix, ...args);
    if (Logger.sink && (resolved === "warn" || resolved === "error")) {
        try {
            Logger.sink(resolved, lineText(args));
        } catch {
            // A sink must never take the logger down with it.
        }
    }
}

/** The arguments of a log call as one line, close to how the console shows them. */
export function lineText(args: readonly unknown[]): string {
    return args
        .map((arg) => {
            if (arg instanceof Error) return arg.message;
            if (typeof arg === "string") return arg;
            if (arg === undefined || arg === null || typeof arg !== "object") return String(arg);
            try {
                const json = JSON.stringify(arg);
                return json.length > 200 ? `${json.slice(0, 199)}…` : json;
            } catch {
                return String(arg);
            }
        })
        .join(" ");
}
