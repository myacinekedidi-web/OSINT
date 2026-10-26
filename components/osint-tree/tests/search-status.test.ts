import { describe, expect, it } from "vitest";
import { getSearchStatus } from "../search-status";

const base = { hasQuery: true, resourceCount: 3, favoritesOnly: false, favoritesCount: 0 };

describe("getSearchStatus", () => {
    it("stays silent when no search is active", () => {
        expect(getSearchStatus({ ...base, hasQuery: false, resourceCount: 26 })).toEqual({
            message: "",
            isEmpty: false,
        });
    });

    it("announces how many resources were found", () => {
        expect(getSearchStatus(base)).toEqual({ message: "3 resources found.", isEmpty: false });
    });

    it("uses the singular for one result", () => {
        expect(getSearchStatus({ ...base, resourceCount: 1 }).message).toBe("1 resource found.");
    });

    it("reports no matches", () => {
        expect(getSearchStatus({ ...base, resourceCount: 0 })).toEqual({
            message: "No matching resources found.",
            isEmpty: true,
        });
    });

    it("explains an empty favorites filter when the user has no favorites", () => {
        const status = getSearchStatus({ ...base, resourceCount: 0, favoritesOnly: true, favoritesCount: 0 });
        expect(status.message).toContain("No favorites yet");
        expect(status.isEmpty).toBe(true);
    });

    it("reports no matches (not 'no favorites') when the user has favorites but none match", () => {
        const status = getSearchStatus({ ...base, resourceCount: 0, favoritesOnly: true, favoritesCount: 2 });
        expect(status.message).toBe("No matching resources found.");
    });
});
