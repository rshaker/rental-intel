import { describe, expect, it } from "vitest";
import { featuresInWords, orderedFeatures, petFeatures } from "./features";
import { FEATURE_KEYS, FILTERS } from "./filters";

describe("the feature vocabulary", () => {
    it("is every flag filter but the housing types and by-owner, in vocabulary order", () => {
        const flags = FILTERS.filter((field) => field.kind === "flag").map((field) => field.key);
        expect(FEATURE_KEYS).toEqual(flags.filter((key) => !key.startsWith("type") && key !== "byOwner"));
        expect(FEATURE_KEYS[0]).toBe("smallDogs");
    });

    it("orderedFeatures drops repeats and keeps vocabulary order", () => {
        expect(orderedFeatures(["pool", "cats", "pool", "laundryInUnit"])).toEqual(["cats", "laundryInUnit", "pool"]);
        expect(orderedFeatures([])).toEqual([]);
    });
});

describe("featuresInWords", () => {
    it("names each feature any label matches", () => {
        const words = { dishwasher: /dishwasher/i, pool: /\bpool\b/i, gym: /fitness/i };
        expect(featuresInWords(["Resort-Style Pool", "Dishwasher", "Pool Table"], words)).toEqual(["dishwasher", "pool"]);
        expect(featuresInWords([], words)).toEqual([]);
    });
});

describe("petFeatures", () => {
    it("reads cats, dog sizes, and dogs alone as both sizes", () => {
        expect(petFeatures(["Cats", "Large dogs", "Small dogs"])).toEqual(["smallDogs", "largeDogs", "cats"]);
        expect(petFeatures(["Cats, Small Dogs"])).toEqual(["smallDogs", "cats"]);
        expect(petFeatures(["SmallDogs", "LargeDogs"])).toEqual(["smallDogs", "largeDogs"]);
        expect(petFeatures(["Dogs Allowed"])).toEqual(["smallDogs", "largeDogs"]);
        expect(petFeatures(["Cats and dogs welcome, $50/mo pet rent"])).toEqual(["smallDogs", "largeDogs", "cats"]);
    });

    it("takes a refusal as nothing", () => {
        expect(petFeatures(["No pets"])).toEqual([]);
        expect(petFeatures(["No Pets Allowed", "Dogs not allowed"])).toEqual([]);
        expect(petFeatures(["Cats Allowed", "No dogs"])).toEqual(["cats"]);
    });
});
