import type { DetailRow, SourceView } from "../contract";
import type { Listing } from "../../db/types";
import { sourceDetail } from "../shared/detail";
import { example } from "./descriptor";
import { EXAMPLE_DETAIL_VERSION, type ExampleDetail } from "./types";

/** The panel's view of an example listing: the rows only this site has. */

const detailOf = (listing: Listing) => sourceDetail<ExampleDetail>(listing, example.id, EXAMPLE_DETAIL_VERSION);

export const exampleView: SourceView = {
    descriptor: example,
    detailRows(listing): DetailRow[] {
        const detail = detailOf(listing);
        if (!detail) return [];
        return [
            ["example.rating", "Rating", detail.rating === null ? null : `${detail.rating} / 5`],
            ["example.units", "Unit ids", detail.unitIds.length ? detail.unitIds.join(", ") : null],
        ];
    },
};
