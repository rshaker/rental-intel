import { db } from "../db/db";
import { upsertCapture } from "../db/listings";
import { getSettings, setSetting } from "../db/settings";

/** `__intel` in the worker's and the panel's DevTools console: the database and a few writes. The Playwright specs seed and inspect through it. */
export const consoleHandle = { db, upsert: upsertCapture, getSettings, setSetting };

export type ConsoleHandle = typeof consoleHandle;

export function installConsoleHandle(): void {
    (globalThis as { __intel?: ConsoleHandle }).__intel = consoleHandle;
}
