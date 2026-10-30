import { describe, expect, it } from "vitest";
import {
    composeQuery,
    parseQuery,
    stripFavoritesToken,
    suggestFavoritesToken,
} from "../filter-tree";

describe("stripFavoritesToken", () => {
    it.each([
        ["@favorites", ""],
        ["@favorites ", ""],
        ["@favorites foo", "foo"],
        ["@favorites   foo bar", "foo bar"],
        ["  @FAVORITES foo", "foo"],
        ["foo", "foo"],
        ["", ""],
        ["@favoritesfoo", "@favoritesfoo"], // not the token: plain text
        ["foo @favorites", "foo @favorites"], // the token only counts at the start
    ])("%j -> %j", (raw, expected) => {
        expect(stripFavoritesToken(raw)).toBe(expected);
    });

    it("keeps a trailing space so the user can keep typing", () => {
        expect(stripFavoritesToken("@favorites foo ")).toBe("foo ");
    });
});

describe("composeQuery", () => {
    it("adds the token in front when the filter is on", () => {
        expect(composeQuery(true, "")).toBe("@favorites ");
        expect(composeQuery(true, "foo")).toBe("@favorites foo");
    });

    it("leaves the text alone when the filter is off", () => {
        expect(composeQuery(false, "foo")).toBe("foo");
    });

    it("round-trips with parseQuery and stripFavoritesToken", () => {
        for (const text of ["", "foo", "foo bar", "foo "]) {
            const raw = composeQuery(true, text);
            expect(parseQuery(raw).favoritesOnly).toBe(true);
            expect(stripFavoritesToken(raw)).toBe(text);
        }
    });
});

describe("suggestFavoritesToken", () => {
    it.each(["@", "@f", "@fa", "@FAV", "  @favor", "@favorite", "@favorites"])("suggests for %j", (text) => {
        expect(suggestFavoritesToken(text)).toBe("@favorites");
    });

    it.each(["", "fav", "@x", "@favoritesx", "@fa vorites", "@favorites foo", "foo @", "@1"])(
        "does not suggest for %j",
        (text) => {
            expect(suggestFavoritesToken(text)).toBeNull();
        },
    );
});
