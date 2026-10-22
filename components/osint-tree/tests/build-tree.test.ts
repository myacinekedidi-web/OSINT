import { describe, expect, it } from "vitest";
import { buildResourceIndex, buildTree, ROOT_ID } from "../build-tree";
import type { OsintData, Resource } from "../osint-types";

const data: OsintData = {
    title: "My OSINT",
    categories: [
        {
            id: "network",
            name: "Network",
            description: "Network tools",
            resources: [
                { id: "shodan", name: "Shodan", url: "https://shodan.io", tags: ["iot"], bestFor: "Devices", caution: "Be careful" },
                { id: "censys", name: "Censys", url: "https://censys.io" },
            ],
        },
        { id: "maps", name: "Maps", resources: [{ id: "earth", name: "Earth", url: "https://earth.google.com" }] },
    ],
};

describe("buildTree", () => {
    it("builds a root named after the title, falling back to a default", () => {
        expect(buildTree(data)).toMatchObject({ id: ROOT_ID, name: "My OSINT", kind: "root" });
        expect(buildTree({ categories: [] }).name).toBe("OSINT Resources");
    });

    it("prefixes category and resource ids so they cannot collide", () => {
        const colliding: OsintData = {
            categories: [{ id: "tools", name: "Tools", resources: [{ id: "tools", name: "Tools site", url: "https://t.io" }] }],
        };
        const root = buildTree(colliding);
        const category = root.children![0];
        const resource = category.children![0];

        expect(category.id).toBe("cat:tools");
        expect(resource.id).toBe("res:tools");
        expect(category.id).not.toBe(resource.id);
    });

    it("sets kinds, counts and copies resource fields", () => {
        const [network, maps] = buildTree(data).children!;

        expect(network).toMatchObject({ kind: "category", name: "Network", description: "Network tools", count: 2 });
        expect(maps.count).toBe(1);
        expect(network.children![0]).toMatchObject({
            kind: "resource",
            name: "Shodan",
            url: "https://shodan.io",
            tags: ["iot"],
            bestFor: "Devices",
            caution: "Be careful",
        });
    });

    it("tolerates missing categories and resources", () => {
        expect(buildTree({} as OsintData).children).toEqual([]);

        const noResources = buildTree({
            categories: [{ id: "x", name: "X", resources: undefined as unknown as Resource[] }],
        });
        expect(noResources.children![0]).toMatchObject({ count: 0, children: [] });
    });
});

describe("buildResourceIndex", () => {
    const root = buildTree(data);
    const index = buildResourceIndex(root);

    it("contains every resource and nothing else", () => {
        expect([...index.keys()].sort()).toEqual(["res:censys", "res:earth", "res:shodan"]);
    });

    it("stores the path from the root to each resource", () => {
        const entry = index.get("res:earth")!;
        expect(entry.node.name).toBe("Earth");
        expect(entry.path.map((n) => n.id)).toEqual([ROOT_ID, "cat:maps", "res:earth"]);
    });

    it("returns undefined for unknown ids and for categories", () => {
        expect(index.get("res:nope")).toBeUndefined();
        expect(index.get("cat:maps")).toBeUndefined();
    });
});
