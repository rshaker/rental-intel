import { describe, expect, it } from "vitest";
import { apartmentsSearch } from "../apartments/urls";
import { exampleSearch } from "../example/urls";
import { zillowSearch } from "../zillow/urls";
import { FILTERS, fieldsFor } from "./filters";

describe("the filter vocabulary", () => {
    it("has no duplicate keys", () => {
        expect(new Set(FILTERS.map((field) => field.key)).size).toBe(FILTERS.length);
    });

    it("every key is offered by at least one shipped source", () => {
        const offered = new Set([...apartmentsSearch.filters!, ...zillowSearch.filters!, ...exampleSearch.filters!].map((field) => field.key));
        for (const field of FILTERS) expect(offered.has(field.key), field.key).toBe(true);
    });

    it("fieldsFor keeps vocabulary order regardless of the keys' order", () => {
        const subset = fieldsFor(["cats", "rentMin", "beds"]);
        expect(subset.map((field) => field.key)).toEqual(["rentMin", "beds", "cats"]);
    });

    it("fieldsFor drops a key the vocabulary does not have", () => {
        expect(fieldsFor(["rentMin", "nope" as never]).map((f) => f.key)).toEqual(["rentMin"]);
    });
});
