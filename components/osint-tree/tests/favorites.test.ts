import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAVORITES_KEY, loadFavorites, saveFavorites } from "../favorites";

// Minimal in-memory localStorage
function fakeStorage(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial));
    return {
        getItem: vi.fn((key: string) => store.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => void store.set(key, value)),
    };
}

beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("loadFavorites", () => {
    it("returns an empty set when nothing is stored", () => {
        vi.stubGlobal("localStorage", fakeStorage());
        expect(loadFavorites()).toEqual(new Set());
    });

    it("loads stored prefixed ids", () => {
        vi.stubGlobal("localStorage", fakeStorage({ [FAVORITES_KEY]: JSON.stringify(["res:a", "res:b"]) }));
        expect(loadFavorites()).toEqual(new Set(["res:a", "res:b"]));
    });

    it("adds the prefix to ids saved before prefixes existed", () => {
        vi.stubGlobal("localStorage", fakeStorage({ [FAVORITES_KEY]: JSON.stringify(["a", "res:b"]) }));
        expect(loadFavorites()).toEqual(new Set(["res:a", "res:b"]));
    });

    it("drops entries that are not strings", () => {
        vi.stubGlobal("localStorage", fakeStorage({ [FAVORITES_KEY]: JSON.stringify(["res:a", 1, null, { x: 1 }]) }));
        expect(loadFavorites()).toEqual(new Set(["res:a"]));
    });

    it("falls back to an empty set for corrupted JSON", () => {
        vi.stubGlobal("localStorage", fakeStorage({ [FAVORITES_KEY]: "{not json" }));
        expect(loadFavorites()).toEqual(new Set());
    });

    it.each(["{}", "123", '"text"', "null"])("falls back to an empty set for non-array JSON (%s)", (value) => {
        vi.stubGlobal("localStorage", fakeStorage({ [FAVORITES_KEY]: value }));
        expect(loadFavorites()).toEqual(new Set());
    });

    it("falls back to an empty set when storage throws", () => {
        vi.stubGlobal("localStorage", {
            getItem: () => {
                throw new Error("blocked");
            },
        });
        expect(loadFavorites()).toEqual(new Set());
    });
});

describe("saveFavorites", () => {
    it("writes the ids as a JSON array", () => {
        const storage = fakeStorage();
        vi.stubGlobal("localStorage", storage);

        saveFavorites(new Set(["res:a", "res:b"]));

        expect(storage.setItem).toHaveBeenCalledWith(FAVORITES_KEY, JSON.stringify(["res:a", "res:b"]));
    });

    it("round-trips with loadFavorites", () => {
        vi.stubGlobal("localStorage", fakeStorage());
        saveFavorites(new Set(["res:a", "res:b"]));
        expect(loadFavorites()).toEqual(new Set(["res:a", "res:b"]));
    });

    it("does not throw when storage fails", () => {
        vi.stubGlobal("localStorage", {
            setItem: () => {
                throw new Error("quota exceeded");
            },
        });
        expect(() => saveFavorites(new Set(["res:a"]))).not.toThrow();
    });
});
