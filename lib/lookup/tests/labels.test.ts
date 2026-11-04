import { describe, expect, it } from "vitest";
import {
    CATEGORY_LABEL,
    SEVERITY_LABEL,
    SOURCE_INFO,
    STATUS_LABEL,
    humanizeKey,
    sourceName,
    sourceUrl,
} from "../labels";
import { FINDING_CATEGORIES, SEVERITIES, SOURCE_IDS, SOURCE_STATUSES } from "../report";

describe("labels cover every id the server can send", () => {
    it.each(SOURCE_IDS)("source %s has a name, an https link and a coverage note", (id) => {
        const info = SOURCE_INFO[id];
        expect(info.name.length).toBeGreaterThan(2);
        expect(info.url.startsWith("https://")).toBe(true);
        expect(info.covers.length).toBeGreaterThan(2);
    });

    it("has a label for every status, severity and category", () => {
        expect(Object.keys(STATUS_LABEL).sort()).toEqual([...SOURCE_STATUSES].sort());
        expect(Object.keys(SEVERITY_LABEL).sort()).toEqual([...SEVERITIES].sort());
        expect(Object.keys(CATEGORY_LABEL).sort()).toEqual([...FINDING_CATEGORIES].sort());
    });
});

describe("sourceName / sourceUrl", () => {
    it("look up known sources", () => {
        expect(sourceName("internetdb")).toBe("Shodan InternetDB");
        expect(sourceUrl("internetdb")).toBe("https://internetdb.shodan.io/");
    });

    it("fall back gracefully for a source a newer server added", () => {
        expect(sourceName("brand-new")).toBe("brand-new");
        expect(sourceUrl("brand-new")).toBeUndefined();
    });
});

describe("humanizeKey", () => {
    it.each([
        ["ports", "Ports"],
        ["http_headers", "Http headers"],
        ["name-servers", "Name servers"],
        ["  spaced  ", "Spaced"],
        ["", ""],
    ])("%j -> %j", (input, expected) => {
        expect(humanizeKey(input)).toBe(expected);
    });
});
