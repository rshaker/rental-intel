import { beforeEach, describe, expect, it } from "vitest";
import { createActivityLog } from "./activityLog";

/** The Data tab's log: stamped lines, kept across openings, capped. */

describe("activity log", () => {
    beforeEach(() => localStorage.clear());

    const at = (h: number, m: number, s: number): Date => new Date(2026, 8, 30, h, m, s);

    it("stamps and marks lines, newest last", () => {
        const log = createActivityLog(() => at(12, 4, 31));
        log.say("Exported 4 listings.");
        log.say("detect threw", "warn");
        log.say("Import failed: bad json", "error");
        expect(log.lines.value).toEqual(["12:04:31  Exported 4 listings.", "12:04:31  ⚠ detect threw", "12:04:31  ✖ Import failed: bad json"]);
        expect(log.text()).toBe(log.lines.value.join("\n"));
    });

    it("comes back after the panel reopens, and clears for good", () => {
        const first = createActivityLog(() => at(1, 0, 0));
        first.say("one");
        const second = createActivityLog(() => at(1, 0, 1));
        expect(second.text()).toBe("01:00:00  one");
        second.say("two");
        expect(second.text()).toBe("01:00:00  one\n01:00:01  two");
        second.clear();
        expect(second.text()).toBe("");
        expect(createActivityLog().text()).toBe("");
    });

    it("keeps the last 400 lines", () => {
        const log = createActivityLog(() => at(0, 0, 0));
        for (let i = 0; i < 450; i++) log.say(`line ${i}`);
        const lines = log.lines.value;
        expect(lines).toHaveLength(400);
        expect(lines[0]).toBe("00:00:00  line 50");
        expect(lines[399]).toBe("00:00:00  line 449");
    });

    it("indents a message's later lines under the stamp", () => {
        const log = createActivityLog(() => at(0, 0, 0));
        log.say("first\nsecond");
        expect(log.text()).toBe("00:00:00  first\n          second");
    });
});
