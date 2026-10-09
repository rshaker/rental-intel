import type { DetailRow, SourceView, ViewContext } from "../contract";
import type { Listing } from "../../db/types";
import { sourceDetail } from "../shared/detail";
import { zillow } from "./descriptor";
import { ZILLOW_DETAIL_VERSION, type ZillowDetail } from "./types";

/** The panel's view of a Zillow listing: the rows only Zillow has. */

const detailOf = (listing: Listing) => sourceDetail<ZillowDetail>(listing, zillow.id, ZILLOW_DETAIL_VERSION);

/**
 * One of Zillow's enum words as plain text: "SINGLE_FAMILY" → "single
 * family". Zillow is not consistent with itself -- a home's `homeType` is
 * "APARTMENT", a building's `homeTypes` holds "apartment" -- and the stored
 * value is kept as the site gave it, so the evening-out happens here.
 */
export function zillowWord(value: string | null): string | null {
    return value === null ? null : value.toLowerCase().replace(/_/g, " ");
}

/** "FOR_RENT" → "for rent", "RECENTLY_SOLD" → "recently sold"; "OTHER" is Zillow's word for off market. */
export function statusText(status: string | null): string | null {
    return status === "OTHER" ? "off market" : zillowWord(status);
}

/**
 * "The Arbor (Cj8kQ2, lot 1002526160) 🌎 🗂️": the building's name and ids
 * as the home carries them, or the saved building's name when the home
 * carries none, with a link to the building's page and, when it is saved,
 * to its card. A greyed card icon says "not saved yet".
 */
function buildingRow(detail: ZillowDetail, ctx: ViewContext): string | Node | null {
    const ids = [detail.buildingKey, detail.buildingLotId && `lot ${detail.buildingLotId}`].filter(Boolean).join(", ");
    const name = detail.buildingName || ctx.building?.core.name || null;
    const text = name ? (ids ? `${name} (${ids})` : name) : ids || null;
    const web = detail.buildingUrl ?? ctx.building?.url ?? null;
    if (!text && !web && !ctx.building) return null;

    const holder = document.createElement("span");
    holder.append(text ?? "Building", " ");
    const icons = document.createElement("span");
    icons.className = "link-icons";
    if (web) icons.append(ctx.webLink(web, "the building"));
    if (ctx.building) {
        icons.append(ctx.cardLink(ctx.building));
    } else {
        const off = document.createElement("span");
        off.className = "icon off";
        off.textContent = "\u{1F5C2}️";
        off.title = "The building is not saved";
        off.setAttribute("aria-label", off.title);
        icons.append(off);
    }
    holder.append(icons);
    return holder;
}

export const zillowView: SourceView = {
    descriptor: zillow,
    detailRows(listing, ctx): DetailRow[] {
        const detail = detailOf(listing);
        if (!detail) return [];
        const rows: DetailRow[] = [];
        if (listing.kind === "home") {
            rows.push(["zillow.building", "Building", buildingRow(detail, ctx)]);
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
