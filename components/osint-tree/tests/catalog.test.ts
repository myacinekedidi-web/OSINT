import { describe, expect, it } from "vitest";
import catalog from "../../../data/osint-resources.json";
import { validateCatalog } from "../validate-catalog";

/** A minimal valid catalog; a fresh copy per call so tests can mutate it freely. */
function validCatalog() {
    return {
        title: "Test",
        version: 1,
        categories: [
            {
                id: "search",
                name: "Search",
                description: "General search tools.",
                resources: [
                    {
                        id: "example-one",
                        name: "Example One",
                        url: "https://example.com/one",
                        description: "What it is.",
                        tags: ["people-search", "public-records"],
                        bestFor: "A starting point.",
                        caution: "Verify results independently.",
                    },
                    {
                        id: "example-two",
                        name: "Example Two",
                        url: "https://example.com/two",
                        description: "What it is.",
                        tags: ["images"],
                        bestFor: "Images.",
                        caution: "Results vary.",
                    },
                ],
            },
        ],
    };
}

type Catalog = ReturnType<typeof validCatalog>;
const resource = (c: Catalog, n = 0) => c.categories[0].resources[n] as Record<string, unknown>;

describe("the real catalog (data/osint-resources.json)", () => {
    it("passes every rule", () => {
        // The message lists every problem, so a CI failure says exactly what to fix
        expect(validateCatalog(catalog), validateCatalog(catalog).join("\n")).toEqual([]);
    });
});

describe("validateCatalog", () => {
    it("accepts a valid catalog", () => {
        expect(validateCatalog(validCatalog())).toEqual([]);
    });

    it.each([null, undefined, [], "text", 42])("rejects a non-object root (%s)", (value) => {
        expect(validateCatalog(value)).toEqual(["catalog: must be a JSON object"]);
    });

    it("requires a non-empty categories array", () => {
        expect(validateCatalog({})).toHaveLength(1);
        expect(validateCatalog({ categories: [] })).toHaveLength(1);
    });

    it("requires a non-empty resources array in each category", () => {
        const c = validCatalog();
        c.categories[0].resources = [];
        expect(validateCatalog(c)[0]).toContain(`"resources" is required`);
    });

    describe("required resource fields", () => {
        it.each(["name", "description", "bestFor", "caution", "url", "tags"])("requires %s", (field) => {
            const c = validCatalog();
            delete resource(c)[field];
            const errors = validateCatalog(c);
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain(`"${field}"`);
        });

        it.each(["description", "bestFor", "caution"])("rejects a blank %s", (field) => {
            const c = validCatalog();
            resource(c)[field] = "   ";
            expect(validateCatalog(c)[0]).toContain(`"${field}"`);
        });

        it("rejects empty tags", () => {
            const c = validCatalog();
            resource(c).tags = [];
            expect(validateCatalog(c)[0]).toContain(`"tags"`);
        });

        it("rejects surrounding whitespace in text", () => {
            const c = validCatalog();
            resource(c).name = " Example One";
            expect(validateCatalog(c)[0]).toContain("whitespace");
        });
    });

    describe("urls", () => {
        it.each(["http://example.com", "javascript:alert(1)", "example.com", "ftp://example.com"])(
            "rejects %s",
            (url) => {
                const c = validCatalog();
                resource(c).url = url;
                expect(validateCatalog(c)[0]).toContain("https URL");
            },
        );

        it("rejects whitespace inside a url", () => {
            const c = validCatalog();
            resource(c).url = "https://example.com/a b";
            expect(validateCatalog(c)[0]).toContain("whitespace");
        });

        it("rejects the same url spelled differently", () => {
            const c = validCatalog();
            resource(c, 1).url = "https://example.com/one/#section";
            expect(validateCatalog(c)[0]).toContain("duplicate url");
        });
    });

    describe("ids and tags", () => {
        it.each(["Bad_ID", "has space", "-lead", "trail-", "double--hyphen", ""])("rejects id %j", (id) => {
            const c = validCatalog();
            resource(c).id = id;
            expect(validateCatalog(c)[0]).toContain("kebab-case");
        });

        it("rejects duplicate resource ids, even across categories", () => {
            const c = validCatalog();
            c.categories.push({
                id: "other",
                name: "Other",
                description: "More.",
                resources: [{ ...resource(c, 0), url: "https://example.org/x" } as Catalog["categories"][0]["resources"][0]],
            });
            expect(validateCatalog(c)[0]).toContain(`duplicate id "example-one"`);
        });

        it("rejects duplicate category ids", () => {
            const c = validCatalog();
            c.categories.push({ ...c.categories[0], resources: [] });
            expect(validateCatalog(c).join("\n")).toContain(`duplicate id "search"`);
        });

        it("rejects a non-kebab-case tag", () => {
            const c = validCatalog();
            resource(c).tags = ["People Search"];
            expect(validateCatalog(c)[0]).toContain("kebab-case");
        });

        it("rejects a duplicate tag", () => {
            const c = validCatalog();
            resource(c).tags = ["images", "images"];
            expect(validateCatalog(c)[0]).toContain(`duplicate tag "images"`);
        });
    });

    describe("typos and shape", () => {
        it("flags an unknown resource field", () => {
            const c = validCatalog();
            const r = resource(c);
            r.cuation = r.caution; // misspelled copy
            expect(validateCatalog(c)[0]).toContain(`unknown field "cuation"`);
        });

        it("flags an unknown category field", () => {
            const c = validCatalog();
            (c.categories[0] as Record<string, unknown>).descripton = "x";
            expect(validateCatalog(c)[0]).toContain(`unknown field "descripton"`);
        });

        it("rejects a non-integer version", () => {
            const c = validCatalog();
            c.version = 1.5;
            expect(validateCatalog(c)[0]).toContain("version");
        });

        it("names the broken resource in the message", () => {
            const c = validCatalog();
            delete resource(c, 1).caution;
            expect(validateCatalog(c)[0]).toContain(`categories[0]`);
            expect(validateCatalog(c)[0]).toContain(`"example-two"`);
        });
    });
});
