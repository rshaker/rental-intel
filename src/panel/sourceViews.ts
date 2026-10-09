import type { SourceView } from "../sources/contract";
import type { SourceId } from "../sources/descriptors";
import { apartmentsView } from "../sources/apartments/view";
import { exampleView } from "../sources/example/view";
import { zillowView } from "../sources/zillow/view";

/** Each source's panel view, keyed by every source id so the compiler notices a source without one. */
export const VIEWS: Record<SourceId, SourceView> = {
    apartments: apartmentsView,
    zillow: zillowView,
    example: exampleView,
};

export function viewFor(source: string): SourceView | undefined {
    return (VIEWS as Record<string, SourceView | undefined>)[source];
}
