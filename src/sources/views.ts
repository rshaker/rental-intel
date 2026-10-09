import type { SourceView } from "./contract";
import type { SourceId } from "./descriptors";
import { apartmentsView } from "./apartments/view";
import { exampleView } from "./example/view";
import { zillowView } from "./zillow/view";

/**
 * Each source's panel view. Panel only. Keyed by every source id so the
 * compiler notices a source without a view; a source with nothing of its own
 * to show still declares one with an empty `detailRows`.
 */
export const VIEWS: Record<SourceId, SourceView> = {
    apartments: apartmentsView,
    zillow: zillowView,
    example: exampleView,
};

export function viewFor(source: string): SourceView | undefined {
    return (VIEWS as Record<string, SourceView | undefined>)[source];
}
