import type { DetailRow, SourceView } from "../contract";
import type { Listing } from "../../db/types";
import { sourceDetail } from "../shared/detail";
import { apartments } from "./descriptor";
import { APARTMENTS_DETAIL_VERSION, type ApartmentsDetail } from "./types";

/** The panel's view of an apartments.com listing: the rows only this site has. */

const detailOf = (listing: Listing) => sourceDetail<ApartmentsDetail>(listing, apartments.id, APARTMENTS_DETAIL_VERSION);

export const apartmentsView: SourceView = {
    descriptor: apartments,
    detailRows(listing): DetailRow[] {
        const detail = detailOf(listing);
        if (!detail) return [];
        const scores = [
            detail.walkScore === null ? "" : `walk ${detail.walkScore}`,
            detail.transitScore === null ? "" : `transit ${detail.transitScore}`,
            detail.bikeScore === null ? "" : `bike ${detail.bikeScore}`,
        ]
            .filter(Boolean)
            .join(" · ");
        return [
            ["apartments.listingId", "Listing id", detail.listingId],
            ["apartments.rating", "Rating", detail.rating === null ? null : `${detail.rating} / 5${detail.reviewCount ? ` (${detail.reviewCount} reviews)` : ""}`],
            ["apartments.scores", "Scores", scores || null],
            ["apartments.built", "Built", detail.yearBuilt === null ? null : String(detail.yearBuilt)],
            ["apartments.units", "Units in building", detail.unitCount === null ? null : String(detail.unitCount)],
        ];
    },
};
