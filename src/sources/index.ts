import type { SourceDescriptor } from "./contract";
import { sourceList, type SourceId } from "./descriptors";
import { matchesAny } from "../lib/matchPattern";

export type { SourceId } from "./descriptors";

/**
 * The runtime registry: the sources this build carries, and the lookups every
 * context needs. Pure, so the worker, the panel and the tests share it. The
 * content scripts do not need it -- each one is built around its own source.
 */
export const SOURCES: readonly SourceDescriptor[] = sourceList(__E2E__);

const BY_ID = new Map(SOURCES.map((source) => [source.id, source]));

export function sourceById(id: string): SourceDescriptor | undefined {
    return BY_ID.get(id);
}

export function isSourceId(value: unknown): value is SourceId {
    return typeof value === "string" && BY_ID.has(value);
}

/** The source whose pages a URL belongs to, if any. */
export function sourceForUrl(url: string): SourceDescriptor | null {
    return SOURCES.find((source) => matchesAny(source.hosts.pages, url)) ?? null;
}

/** The host permissions a source needs, pages and photos together. */
export function hostsOf(source: SourceDescriptor): string[] {
    return [...new Set([...source.hosts.pages, ...source.hosts.photos])];
}

/** The label a source id is shown under, tolerating an id from a build that no longer has it. */
export function sourceLabel(id: string): string {
    return BY_ID.get(id)?.label ?? id;
}

/** The three-letter code a source is tagged with on a card row; an unknown id shows its first three letters. */
export function sourceCode(id: string): string {
    return BY_ID.get(id)?.code ?? id.slice(0, 3).toUpperCase();
}
