import { describe, expect, it } from "vitest";
import { SOURCES } from "../sources";
import { listingIdInUrl, offSourceForUrl } from "./activeTab";

const EXAMPLE_URL = "https://listings.example/l/juniper01/";
const none = () => false;
const all = () => true;

describe("offSourceForUrl", () => {
    it("names the site a URL belongs to while that site is off", () => {
        expect(offSourceForUrl(EXAMPLE_URL, none)?.id).toBe("example");
        expect(offSourceForUrl(EXAMPLE_URL, none)?.label).toBe(SOURCES.find((s) => s.id === "example")?.label);
    });

    it("is silent once the site is on, on an unknown site, and with no URL", () => {
        expect(offSourceForUrl(EXAMPLE_URL, all)).toBeNull();
        expect(offSourceForUrl("https://example.org/listing/1", none)).toBeNull();
        expect(offSourceForUrl(null, none)).toBeNull();
    });
});

describe("listingIdInUrl", () => {
    it("names the listing only on an enabled site", () => {
        expect(listingIdInUrl(EXAMPLE_URL, all)).toEqual({ source: "example", sourceId: "juniper01" });
        expect(listingIdInUrl(EXAMPLE_URL, none)).toBeNull();
    });
});
