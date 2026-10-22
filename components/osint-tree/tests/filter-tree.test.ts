import { describe, expect, it } from "vitest";
import { filterTree, matchesResource, parseQuery, toggleFavoritesToken, type FilterContext } from "../filter-tree";
import type { TreeNode } from "../osint-types";

/* ------------------------------- Test fixture ------------------------------ */

const resource = (id: string, name: string, extra: Partial<TreeNode> = {}): TreeNode => ({
    id: `res:${id}`,
    name,
    kind: "resource",
    url: `https://example.com/${id}`,
    ...extra,
});

const category = (id: string, name: string, children: TreeNode[]): TreeNode => ({
    id: `cat:${id}`,
    name,
    kind: "category",
    count: children.length,
    children,
});

// root
// ├─ People  (pipl, hunter)
// ├─ Network (shodan, censys)
// └─ Maps    (earth, sentinel)
const buildRoot = (): TreeNode => ({
    id: "osint-root",
    name: "OSINT",
    kind: "root",
    children: [
        category("people", "People", [
            resource("pipl", "Pipl", { description: "People search engine" }),
            resource("hunter", "Hunter", { tags: ["email", "domains"] }),
        ]),
        category("network", "Network", [
            resource("shodan", "Shodan", { description: "Search engine for internet-connected devices" }),
            resource("censys", "Censys", { url: "https://search.censys.io" }),
        ]),
        category("maps", "Maps", [
            resource("earth", "Google Earth", { bestFor: "Satellite imagery" }),
            resource("sentinel", "Sentinel Hub", { caution: "Rate limited on the free tier" }),
        ]),
    ],
});

const NO_QUERY = parseQuery("");
const ctx = (over: Partial<FilterContext> = {}): FilterContext => ({
    favorites: new Set(),
    expanded: {},
    ...over,
});

// Names of the resources left in a filtered tree, in order
const resourceNames = (root: TreeNode): string[] =>
    (root.children ?? []).flatMap((c) => (c.children ?? []).map((r) => r.name));
const categoryIds = (root: TreeNode): string[] => (root.children ?? []).map((c) => c.id);

/* -------------------------------- parseQuery ------------------------------- */

describe("parseQuery", () => {
    it("treats empty and whitespace-only input as no query", () => {
        expect(parseQuery("")).toEqual({ favoritesOnly: false, text: "", hasQuery: false });
        expect(parseQuery("   ")).toEqual({ favoritesOnly: false, text: "", hasQuery: false });
    });

    it("trims and lowercases plain text", () => {
        expect(parseQuery("  Shodan ")).toEqual({ favoritesOnly: false, text: "shodan", hasQuery: true });
    });

    it("recognizes the favorites token on its own", () => {
        expect(parseQuery("@favorites")).toEqual({ favoritesOnly: true, text: "", hasQuery: true });
    });

    it("splits the token from the remaining text, ignoring case and extra spaces", () => {
        expect(parseQuery("  @FAVORITES   Shodan ")).toEqual({
            favoritesOnly: true,
            text: "shodan",
            hasQuery: true,
        });
    });

    it("only treats the token as a whole word", () => {
        expect(parseQuery("@favoritesfoo")).toEqual({
            favoritesOnly: false,
            text: "@favoritesfoo",
            hasQuery: true,
        });
    });

    it("only treats the token as such at the start of the input", () => {
        expect(parseQuery("shodan @favorites")).toEqual({
            favoritesOnly: false,
            text: "shodan @favorites",
            hasQuery: true,
        });
    });

    it("keeps a partially typed token as plain text", () => {
        expect(parseQuery("@fav")).toEqual({ favoritesOnly: false, text: "@fav", hasQuery: true });
    });
});

/* ---------------------------- toggleFavoritesToken ---------------------------- */

describe("toggleFavoritesToken", () => {
    it("turns the filter on for an empty input, leaving a space to keep typing", () => {
        expect(toggleFavoritesToken("")).toBe("@favorites ");
        expect(parseQuery(toggleFavoritesToken("")).favoritesOnly).toBe(true);
    });

    it("puts the token in front of existing text and keeps its casing", () => {
        expect(toggleFavoritesToken("shodan")).toBe("@favorites shodan");
        expect(toggleFavoritesToken("Shodan")).toBe("@favorites Shodan");
        expect(toggleFavoritesToken("  shodan")).toBe("@favorites shodan");
    });

    it("turns the filter off, clearing the input when only the token was there", () => {
        expect(toggleFavoritesToken("@favorites")).toBe("");
        expect(toggleFavoritesToken("@favorites ")).toBe("");
    });

    it("turns the filter off but keeps the remaining text and its casing", () => {
        expect(toggleFavoritesToken("@favorites Shodan")).toBe("Shodan");
        expect(toggleFavoritesToken("@FAVORITES   Shodan")).toBe("Shodan");
    });

    it("treats a lookalike as plain text and adds the real token", () => {
        expect(toggleFavoritesToken("@favoritesfoo")).toBe("@favorites @favoritesfoo");
    });

    it("flips favoritesOnly every time", () => {
        for (const start of ["", "shodan", "@favorites", "@favorites shodan"]) {
            const before = parseQuery(start).favoritesOnly;
            expect(parseQuery(toggleFavoritesToken(start)).favoritesOnly).toBe(!before);
        }
    });

    it("returns to the original text after two toggles", () => {
        expect(toggleFavoritesToken(toggleFavoritesToken("Shodan"))).toBe("Shodan");
        expect(toggleFavoritesToken(toggleFavoritesToken(""))).toBe("");
    });
});

/* ----------------------------- matchesResource ----------------------------- */

describe("matchesResource", () => {
    const node = resource("demo", "Demo Tool", {
        description: "Finds Things",
        tags: ["alpha", "beta"],
        bestFor: "Quick lookups",
        caution: "Needs an account",
    });

    it("matches every resource when there is no query", () => {
        expect(matchesResource(node, NO_QUERY, new Set())).toBe(true);
    });

    it.each([
        ["name", "demo tool"],
        ["url", "example.com/demo"],
        ["description", "finds things"],
        ["a tag", "beta"],
        ["bestFor", "quick lookups"],
        ["caution", "needs an account"],
    ])("matches on the %s", (_field, text) => {
        expect(matchesResource(node, parseQuery(text), new Set())).toBe(true);
    });

    it("is case-insensitive", () => {
        expect(matchesResource(node, parseQuery("DEMO"), new Set())).toBe(true);
    });

    it("does not match unrelated text", () => {
        expect(matchesResource(node, parseQuery("zzz"), new Set())).toBe(false);
    });

    it("requires the resource to be a favorite when favoritesOnly is set", () => {
        const query = parseQuery("@favorites");
        expect(matchesResource(node, query, new Set())).toBe(false);
        expect(matchesResource(node, query, new Set([node.id]))).toBe(true);
    });

    it("applies both the favorites and the text filter together", () => {
        const favorites = new Set([node.id]);
        expect(matchesResource(node, parseQuery("@favorites demo"), favorites)).toBe(true);
        expect(matchesResource(node, parseQuery("@favorites zzz"), favorites)).toBe(false);
    });
});

/* -------------------------------- filterTree ------------------------------- */

describe("filterTree without a query", () => {
    it("shows only the root and the categories when nothing is expanded", () => {
        const result = filterTree(buildRoot(), NO_QUERY, ctx());
        expect(categoryIds(result)).toEqual(["cat:people", "cat:network", "cat:maps"]);
        expect(result.children!.every((c) => c.children === undefined)).toBe(true);
    });

    it("shows the resources of expanded categories only", () => {
        const result = filterTree(buildRoot(), NO_QUERY, ctx({ expanded: { "cat:network": true } }));
        expect(resourceNames(result)).toEqual(["Shodan", "Censys"]);
        expect(result.children!.find((c) => c.id === "cat:people")!.children).toBeUndefined();
    });

    it("keeps category counts as the total number of resources", () => {
        const result = filterTree(buildRoot(), NO_QUERY, ctx());
        expect(result.children!.map((c) => c.count)).toEqual([2, 2, 2]);
    });
});

describe("filterTree with a text query", () => {
    it("keeps only matching resources and auto-expands their categories", () => {
        const result = filterTree(buildRoot(), parseQuery("shodan"), ctx());
        expect(categoryIds(result)).toEqual(["cat:network"]);
        expect(resourceNames(result)).toEqual(["Shodan"]);
    });

    it("ignores the expanded state while filtering", () => {
        const result = filterTree(buildRoot(), parseQuery("pipl"), ctx({ expanded: { "cat:maps": true } }));
        expect(categoryIds(result)).toEqual(["cat:people"]);
    });

    it("matches across categories", () => {
        const result = filterTree(buildRoot(), parseQuery("search"), ctx());
        expect(categoryIds(result)).toEqual(["cat:people", "cat:network"]);
        expect(resourceNames(result)).toEqual(["Pipl", "Shodan", "Censys"]);
    });

    it("returns the root with no children when nothing matches", () => {
        const result = filterTree(buildRoot(), parseQuery("zzz"), ctx());
        expect(result.kind).toBe("root");
        expect(result.children).toEqual([]);
    });

    it("strips children from resource nodes", () => {
        const result = filterTree(buildRoot(), parseQuery("shodan"), ctx());
        expect(result.children![0].children![0].children).toBeUndefined();
    });
});

describe("filterTree with favorites", () => {
    const favorites = new Set(["res:hunter", "res:sentinel"]);

    it("shows only favorited resources, grouped by their categories", () => {
        const result = filterTree(buildRoot(), parseQuery("@favorites"), ctx({ favorites }));
        expect(categoryIds(result)).toEqual(["cat:people", "cat:maps"]);
        expect(resourceNames(result)).toEqual(["Hunter", "Sentinel Hub"]);
    });

    it("narrows favorites by the remaining text", () => {
        const result = filterTree(buildRoot(), parseQuery("@favorites hub"), ctx({ favorites }));
        expect(categoryIds(result)).toEqual(["cat:maps"]);
        expect(resourceNames(result)).toEqual(["Sentinel Hub"]);
    });

    it("returns the root with no children when there are no favorites", () => {
        const result = filterTree(buildRoot(), parseQuery("@favorites"), ctx());
        expect(result.children).toEqual([]);
    });
});

describe("filterTree matchedCount", () => {
    const find = (root: TreeNode, id: string) => root.children!.find((c) => c.id === id)!;

    it("is undefined on every category when there is no query, even when expanded", () => {
        const result = filterTree(buildRoot(), NO_QUERY, ctx({ expanded: { "cat:people": true, "cat:maps": true } }));
        expect(result.children!.every((c) => c.matchedCount === undefined)).toBe(true);
    });

    it("counts the matching resources per category for a text query", () => {
        const result = filterTree(buildRoot(), parseQuery("search"), ctx());
        expect(find(result, "cat:people").matchedCount).toBe(1); // Pipl
        expect(find(result, "cat:network").matchedCount).toBe(2); // Shodan, Censys
    });

    it("counts favorites per category for the favorites filter", () => {
        const favorites = new Set(["res:hunter", "res:sentinel"]);
        const result = filterTree(buildRoot(), parseQuery("@favorites"), ctx({ favorites }));
        expect(find(result, "cat:people").matchedCount).toBe(1);
        expect(find(result, "cat:maps").matchedCount).toBe(1);
    });

    it("combines the favorites filter with a text query", () => {
        const favorites = new Set(["res:pipl", "res:hunter", "res:shodan"]);
        const result = filterTree(buildRoot(), parseQuery("@favorites search"), ctx({ favorites }));
        expect(find(result, "cat:people").matchedCount).toBe(1); // Pipl only (Hunter lacks "search")
        expect(find(result, "cat:network").matchedCount).toBe(1); // Shodan only
    });

    it("keeps count as the total number of resources", () => {
        const result = filterTree(buildRoot(), parseQuery("shodan"), ctx());
        const network = find(result, "cat:network");
        expect(network.matchedCount).toBe(1);
        expect(network.count).toBe(2);
    });

    it("equals the number of resources left in the category", () => {
        const result = filterTree(buildRoot(), parseQuery("search"), ctx());
        for (const category of result.children!) {
            expect(category.matchedCount).toBe(category.children!.length);
        }
    });

    it("is not set on the root or on resources", () => {
        const result = filterTree(buildRoot(), parseQuery("shodan"), ctx());
        expect(result.matchedCount).toBeUndefined();
        expect(find(result, "cat:network").children!.every((r) => r.matchedCount === undefined)).toBe(true);
    });

    it("never leaks into the source tree", () => {
        const root = buildRoot();
        filterTree(root, parseQuery("search"), ctx());
        expect(root.children!.every((c) => c.matchedCount === undefined)).toBe(true);
    });
});

describe("filterTree purity", () => {
    it("does not modify the input tree", () => {
        const root = buildRoot();
        const snapshot = structuredClone(root);

        filterTree(root, parseQuery("shodan"), ctx());
        filterTree(root, NO_QUERY, ctx({ expanded: { "cat:people": true } }));
        filterTree(root, parseQuery("@favorites"), ctx({ favorites: new Set(["res:hunter"]) }));

        expect(root).toEqual(snapshot);
    });

    it("returns equal results for equal inputs", () => {
        const root = buildRoot();
        const a = filterTree(root, parseQuery("search"), ctx());
        const b = filterTree(root, parseQuery("search"), ctx());
        expect(a).toEqual(b);
    });
});
