/** Waiting and asking again, for every context that polls a page. No Chrome APIs here. */

/** Thrown out of a wait that an AbortSignal cut short. */
export class Cancelled extends Error {}

/** Waits `ms`, or rejects with Cancelled the moment `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new Cancelled());
    return new Promise((resolve, reject) => {
        const onAbort = (): void => {
            clearTimeout(timer);
            reject(new Cancelled());
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

export interface PollOptions {
    /** How long to wait before attempt n (n starts at 1; the first ask is immediate): a number, or a function that returns null to stop asking. */
    every: number | ((attempt: number) => number | null);
    /** When to stop asking, as a `Date.now()` value. Infinity by default. */
    deadline?: number;
    signal?: AbortSignal;
}

/** Asks until `accept` makes something of an answer, and returns that; null when the deadline or the schedule runs out first. Throws Cancelled when the signal aborts. */
export async function poll<R, T>(ask: () => Promise<R>, accept: (response: R, attempt: number) => T | null | undefined, { every, deadline = Infinity, signal }: PollOptions): Promise<T | null> {
    for (let attempt = 0; ; attempt++) {
        if (signal?.aborted) throw new Cancelled();
        const response = await ask();
        if (signal?.aborted) throw new Cancelled();
        const found = accept(response, attempt);
        if (found !== null && found !== undefined) return found;
        const wait = typeof every === "number" ? every : every(attempt + 1);
        const left = deadline - Date.now();
        if (wait === null || left <= 0) return null;
        await sleep(Math.min(wait, left), signal);
    }
}
