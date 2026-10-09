import type { DetailRow, SourceView, ViewContext } from "../contract";
import type { Listing } from "../../db/types";
import { LinkIcons } from "../../panel/components/links";
import { sourceDetail } from "../shared/detail";
import { zillow } from "./descriptor";
import { ZILLOW_DETAIL_VERSION, type ZillowDetail } from "./types";

/** The panel's view of a Zillow listing: the rows only Zillow has. */

const detailOf = (listing: Listing) => sourceDetail<ZillowDetail>(listing, zillow.id, ZILLOW_DETAIL_VERSION);

/** "SINGLE_FAMILY" → "single family". Zillow's enum words are stored as given; the evening-out happens here. */
export function zillowWord(value: string | null): string | null {
    return value === null ? null : value.toLowerCase().replace(/_/g, " ");
}

/** "FOR_RENT" → "for rent"; "OTHER" is Zillow's word for off market. */
export function statusText(status: string | null): string | null {
    return status === "OTHER" ? "off market" : zillowWord(status);
}

/** The building a home is in, with links to its page and, when saved, its card. */
function BuildingRow({ detail, ctx }: { detail: ZillowDetail; ctx: ViewContext }) {
    const ids = [detail.buildingKey, detail.buildingLotId && `lot ${detail.buildingLotId}`].filter(Boolean).join(", ");
    const name = detail.buildingName || ctx.building?.core.name || null;
    const text = name ? (ids ? `${name} (${ids})` : name) : ids || null;
    const web = detail.buildingUrl ?? ctx.building?.url ?? null;
    if (!text && !web && !ctx.building) return null;
    return (
        <span>
            {text ?? "Building"} <LinkIcons slots={{ web, card: ctx.building ? { id: ctx.building.id, name: ctx.building.core.name ?? ctx.building.url } : null }} describe="the building" onJump={ctx.onJump} />
        </span>
    );
}

export const zillowView: SourceView = {
    descriptor: zillow,
    detailRows(listing, ctx): DetailRow[] {
        const detail = detailOf(listing);
        if (!detail) return [];
        const rows: DetailRow[] = [];
        if (listing.kind === "home") {
            rows.push(["zillow.building", "Building", <BuildingRow detail={detail} ctx={ctx} />]);
            rows.push(["zillow.zestimate", "Rent Zestimate", detail.rentZestimate === null ? null : `$${detail.rentZestimate.toLocaleString()} / mo`]);
            rows.push(["zillow.status", "Status", statusText(detail.status)]);
        } else {
            rows.push(["zillow.lotId", "Lot id", detail.lotId]);
        }
        rows.push(["zillow.homeType", "Zillow type", zillowWord(detail.homeType)]);
        rows.push(["zillow.built", "Built", detail.yearBuilt === null ? null : String(detail.yearBuilt)]);
        return rows;
    },
};
