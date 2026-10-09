import { describe, expect, it } from "vitest";
import { detectListing, extractCapture } from "../../content/detect";
import { zillowPage } from "./page";
import { addressFromHeading, galleryPhotos, homeFromDom } from "./page/dom";
import { readHydrationState } from "./page/hydration";
import type { ZillowDetail } from "./types";

/**
 * The Zillow reader without a payload: the DOM fallback, shaped like the
 * captured home page's markup (October 2026), and the page-world bridge
 * element that a stale tab's helper writes.
 */

const HOME_URL = "https://www.zillow.com/homedetails/710-E-Dean-Keeton-St-111-Austin-TX-78705/450233440_zpid/";

/** The home page's layout with the text a person sees, and no payload at all. */
const LAYOUT = `<!doctype html><html><head>
<link rel="canonical" href="${HOME_URL}">
</head><body>
<header><img src="https://www.zillowstatic.com/s3/pfs/static/z-logo-default.svg" alt="Zillow"></header>
<div data-testid="hollywood-gallery">
  <img src="https://photos.zillowstatic.com/fp/26b13be66762296eee797274b12ce7b2-cc_ft_576.jpg" alt="1">
  <img src="https://photos.zillowstatic.com/fp/26b13be66762296eee797274b12ce7b2-cc_ft_1536.jpg" alt="1 large">
  <img src="https://photos.zillowstatic.com/fp/9f8e7d6c5b4a39281706f5e4d3c2b1a0-cc_ft_768.jpg" alt="2">
  <img src="https://photos.zillowstatic.com/fp/436cc5a8341f61d97aa8c37ecefa48b8-h_e.jpg" alt="agent">
</div>
<span data-testid="price"><span>$1,150/mo</span></span>
<h1>710 E Dean Keeton St, # 111,&nbsp;Austin, TX 78705</h1>
<div data-testid="bed-bath-sqft-facts">
  <div data-testid="bed-bath-sqft-fact-container"><span>1</span><span>beds</span></div>
  <div data-testid="bed-bath-sqft-fact-container"><span>1</span><span>baths</span></div>
  <div data-testid="bed-bath-sqft-fact-container"><span>600</span><span>sqft</span></div>
</div>
<div data-testid="description"><article><div>Available August 2026! Just across the street from campus.</div></article></div>
<ul><li><a href="/austin-tx/rent-apartments/">Austin</a></li><li><a href="/b/710-e-dean-keeton-st-austin-tx-CvBTSB/">710 E Dean Keeton St</a></li></ul>
</body></html>`;

function parse(html: string): Document {
    return new DOMParser().parseFromString(html, "text/html");
}

describe("addressFromHeading", () => {
    it("reads Zillow's heading with the unit as its own segment", () => {
        expect(addressFromHeading("710 E Dean Keeton St, # 111, Austin, TX 78705")).toEqual({
            line1: "710 E Dean Keeton St",
            unit: "111",
            city: "Austin",
            state: "TX",
            zip: "78705",
            text: "710 E Dean Keeton St, # 111, Austin, TX 78705",
        });
        expect(addressFromHeading("1800 Lavaca St APT 101, Austin, TX 78701")).toMatchObject({ line1: "1800 Lavaca St", unit: "101", city: "Austin", zip: "78701" });
        expect(addressFromHeading("4100 Duval St, Round Rock, TX 78664")).toMatchObject({ line1: "4100 Duval St", unit: null, city: "Round Rock", state: "TX", zip: "78664" });
        expect(addressFromHeading(null).text).toBeNull();
    });
});

describe("galleryPhotos", () => {
    it("keeps one URL per photo at its largest size, and no logo or portrait", () => {
        expect(galleryPhotos(parse(LAYOUT))).toEqual([
            "https://photos.zillowstatic.com/fp/26b13be66762296eee797274b12ce7b2-cc_ft_1536.jpg",
            "https://photos.zillowstatic.com/fp/9f8e7d6c5b4a39281706f5e4d3c2b1a0-cc_ft_768.jpg",
        ]);
    });
});

describe("homeFromDom", () => {
    it("reads rent, rooms, size, address, description, photos and the building from the layout", () => {
        const { core, detail } = homeFromDom(parse(LAYOUT));
        expect(core.rent).toEqual({ min: 1150, max: 1150 });
        expect(core.beds).toEqual({ min: 1, max: 1 });
        expect(core.baths).toEqual({ min: 1, max: 1 });
        expect(core.sqft).toEqual({ min: 600, max: 600 });
        expect(core.address.text).toBe("710 E Dean Keeton St, # 111, Austin, TX 78705");
        expect(core.description).toBe("Available August 2026! Just across the street from campus.");
        expect(core.photoUrls).toHaveLength(2);
        expect(detail).toMatchObject({ via: "dom", buildingKey: "CvBTSB", buildingUrl: "https://www.zillow.com/b/710-e-dean-keeton-st-austin-tx-CvBTSB/", buildingName: "710 E Dean Keeton St" });
    });

    it("is what a forced parse yields without a payload, marked partial", () => {
        const capture = extractCapture(zillowPage, parse(LAYOUT), HOME_URL)!;
        expect(capture.partial).toBe(true);
        expect(capture.via).toBe("dom");
        expect(capture.core.beds.min).toBe(1);
        expect((capture.detail.data as ZillowDetail).buildingKey).toBe("CvBTSB");
    });
});

describe("the page-world bridge", () => {
    const node = { zpid: 999999999, price: 4321, bedrooms: 3, bathrooms: 2, livingArea: 1200, homeType: "CONDO", address: { streetAddress: "1 Bridge St", city: "Austin", state: "TX", zipcode: "78701" }, originalPhotos: [] };
    const bridge = `<script id="__intel_zillow_state" type="application/json">${JSON.stringify({ intel: "zillow-router-state", props: { pageProps: { componentProps: { gdpClientCache: { "Query{}": { property: node } } } } } })}</script>`;
    const stale = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { componentProps: { property: { zpid: 450233440, price: 1150, bedrooms: 1 } } } } })}</script>`;

    it("is read before __NEXT_DATA__ and yields the router's listing in full", () => {
        const doc = parse(LAYOUT.replace("</body>", `${stale}${bridge}</body>`));
        const state = readHydrationState(doc) as { intel?: string };
        expect(state.intel).toBe("zillow-router-state");
        const capture = extractCapture(zillowPage, doc, "https://www.zillow.com/homedetails/x/999999999_zpid/")!;
        expect(capture.partial).toBe(false);
        expect(capture.via).toBe("hydration");
        expect(capture.core.rent.min).toBe(4321);
        expect(capture.core.beds.min).toBe(3);
        expect(capture.core.propertyType).toBe("condo");
    });

    it("reads each listing from whichever payload names it", () => {
        const doc = parse(LAYOUT.replace("</body>", `${stale}${bridge}</body>`));
        // The bridge comes first, but this zpid is only in __NEXT_DATA__, and
        // that is where it is read from: every block is searched.
        const capture = extractCapture(zillowPage, doc, HOME_URL)!;
        expect(capture.partial).toBe(false);
        expect(capture.core.rent.min).toBe(1150);
        // A zpid no block names falls to the layout.
        expect(extractCapture(zillowPage, doc, "https://www.zillow.com/homedetails/x/123_zpid/")!.partial).toBe(true);
    });

    it("counts a payload for another listing against the page, until the bridge lands", () => {
        // A tab that moved from 450233440 to 999999999 in-page: __NEXT_DATA__
        // is stale and the bridge has not published yet.
        const before = parse(LAYOUT.replace("</body>", `${stale}</body>`));
        const url = "https://www.zillow.com/homedetails/x/999999999_zpid/";
        const first = detectListing(zillowPage, before, url);
        expect(first.confirmed).toBe(false);
        expect(first.signals.find((s) => s.name === "hydration")).toMatchObject({ present: true, claim: "450233440" });
        // Then the helper publishes the router's state, and the page confirms.
        const after = parse(LAYOUT.replace("</body>", `${stale}${bridge}</body>`).replace(`href="${HOME_URL}"`, `href="${url}"`));
        expect(detectListing(zillowPage, after, url).confirmed).toBe(true);
    });
});
