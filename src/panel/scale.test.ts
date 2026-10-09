import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SCALE, SCALE_KEY, applyScale, bootScale, currentScale, neighbourScale, parseScale, scaleShortcut, steppedScale } from "./scale";

const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("the size setting", () => {
    beforeEach(() => {
        localStorage.clear();
        document.documentElement.style.removeProperty("--ui-scale");
        applyScale(DEFAULT_SCALE);
    });

    it("accepts only the listed stops", () => {
        expect(parseScale("125")).toBe("125");
        expect(parseScale("100")).toBe("100");
        expect(parseScale("120")).toBeNull();
        expect(parseScale(125)).toBeNull();
        expect(parseScale(null)).toBeNull();
    });

    it("steps along the stops and stays put at either end", () => {
        expect(neighbourScale("100", 1)).toBe("110");
        expect(neighbourScale("100", -1)).toBe("90");
        expect(neighbourScale("200", 1)).toBe("200");
        expect(neighbourScale("75", -1)).toBe("75");
    });

    it("reads the zoom keys with either modifier and nothing else", () => {
        expect(scaleShortcut(key({ key: "=", metaKey: true }))).toBe(1);
        expect(scaleShortcut(key({ key: "+", ctrlKey: true, shiftKey: true }))).toBe(1);
        expect(scaleShortcut(key({ key: "-", ctrlKey: true }))).toBe(-1);
        expect(scaleShortcut(key({ key: "0", metaKey: true }))).toBe(0);
        expect(scaleShortcut(key({ key: "=" }))).toBeNull();
        expect(scaleShortcut(key({ key: "=", metaKey: true, altKey: true }))).toBeNull();
        expect(scaleShortcut(key({ key: "a", metaKey: true }))).toBeNull();
    });

    it("draws the size as the --ui-scale factor and mirrors it", () => {
        applyScale("150");
        expect(currentScale()).toBe("150");
        expect(document.documentElement.style.getPropertyValue("--ui-scale")).toBe("1.5");
        expect(localStorage.getItem(SCALE_KEY)).toBe("150");
        expect(steppedScale(1)).toBe("175");
        expect(steppedScale(0)).toBe("100");
    });

    it("boots from the mirror and ignores a damaged one", () => {
        localStorage.setItem(SCALE_KEY, "125");
        bootScale();
        expect(currentScale()).toBe("125");
        expect(document.documentElement.style.getPropertyValue("--ui-scale")).toBe("1.25");

        localStorage.setItem(SCALE_KEY, "huge");
        bootScale();
        expect(currentScale()).toBe("125");
    });
});
