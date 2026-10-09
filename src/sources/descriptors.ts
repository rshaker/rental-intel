import type { SourceDescriptor } from "./contract.js";
import { apartments } from "./apartments/descriptor.js";
import { example } from "./example/descriptor.js";
import { zillow } from "./zillow/descriptor.js";

/** Every source the extension knows. The example source ships only in test builds (`__E2E__` at runtime, `process.env.E2E` in the manifest). */
const ALL = [apartments, zillow, example] as const;

const TEST_ONLY: ReadonlySet<SourceId> = new Set(["example"]);

export type SourceId = (typeof ALL)[number]["id"];

export function sourceList(e2e: boolean): readonly SourceDescriptor[] {
    return ALL.filter((source) => e2e || !TEST_ONLY.has(source.id));
}

/** The optional host permissions a build declares: every host of every source it carries. */
export function allHosts(sources: readonly SourceDescriptor[]): string[] {
    return [...new Set(sources.flatMap((source) => [...source.hosts.pages, ...source.hosts.photos]))];
}
