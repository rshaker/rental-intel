import type { Worker } from "@playwright/test";
import { emptyCore, rangeOf, type Capture, type CoreFields } from "../../src/db/types";

/**
 * Seeding the database from a spec, through the worker's console handle. A
 * capture is plain data, so it is built here in Node and handed to the
 * worker, which is the only place `__intel.upsert` exists.
 */

export interface SeedSpec {
    source?: string;
    sourceId: string;
    url: string;
    kind?: "home" | "building";
    core?: Partial<CoreFields>;
    rent?: number;
}

export function captureFor(spec: SeedSpec): Capture {
    const core = { ...emptyCore(), ...spec.core };
    if (spec.rent !== undefined) core.rent = rangeOf(spec.rent);
    return {
        source: (spec.source ?? "example") as Capture["source"],
        sourceId: spec.sourceId,
        url: spec.url,
        kind: spec.kind ?? "home",
        core,
        detail: { version: 1, data: null },
        via: "seed",
        partial: false,
        raw: null,
    };
}

/** Saves a listing and returns its id. */
export async function seedListing(worker: Worker, spec: SeedSpec): Promise<string> {
    const capture = captureFor(spec);
    return worker.evaluate(async (c) => (await __intel!.upsert!(c)).id, capture);
}
