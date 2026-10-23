import type { SourceDescriptor } from "./contract.js";
import { apartments } from "./apartments/descriptor.js";
import { example } from "./example/descriptor.js";
import { zillow } from "./zillow/descriptor.js";

/** Every source the extension knows, in Sources-tab order. The example source is in every build, at the published site for a release (example/siteOrigins.ts). */
export const ALL_SOURCES = [apartments, zillow, example] as const;

export type SourceId = (typeof ALL_SOURCES)[number]["id"];

/** The optional host permissions a build declares: every host of every source it carries. */
export function allHosts(sources: readonly SourceDescriptor[]): string[] {
    return [...new Set(sources.flatMap((source) => [...source.hosts.pages, ...source.hosts.photos]))];
}
