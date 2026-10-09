import type { SourceDescriptor } from "./contract.js";
import { apartments } from "./apartments/descriptor.js";
import { example } from "./example/descriptor.js";
import { zillow } from "./zillow/descriptor.js";

/**
 * Every source the extension knows, as pure descriptors. THIS IS THE LIST TO
 * EXTEND when adding a source; scripts.ts and views.ts are keyed by `SourceId`
 * and the compiler will ask for their entries.
 *
 * A function rather than a constant because the list depends on the build:
 * the example source (src/sources/example/) exists to exercise the core
 * against a synthetic site in the test suite, and ships in no release. The
 * runtime registry (index.ts) passes `__E2E__`; manifest.config.ts, which
 * runs in Node, passes `process.env.E2E`.
 */
const ALL = [apartments, zillow, example] as const;

/** Sources only a test build carries. */
const TEST_ONLY: ReadonlySet<SourceId> = new Set(["example"]);

export type SourceId = (typeof ALL)[number]["id"];

export function sourceList(e2e: boolean): readonly SourceDescriptor[] {
    return ALL.filter((source) => e2e || !TEST_ONLY.has(source.id));
}

/** The optional host permissions a build declares: every host of every source it carries. */
export function allHosts(sources: readonly SourceDescriptor[]): string[] {
    return [...new Set(sources.flatMap((source) => [...source.hosts.pages, ...source.hosts.photos]))];
}
