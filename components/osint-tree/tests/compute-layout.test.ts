import { describe, expect, it } from "vitest";
import { computeLayout, type TreeLayout } from "../compute-layout";
import type { TreeNode } from "../osint-types";
import {
    BRANCH_GAP,
    GROUP_SEPARATION,
    LINK_DURATION,
    LINK_DURATION_UPDATE,
    MARGIN,
    MAX_STAGGER_ITEMS,
    NODE_HEIGHT,
    NODE_WIDTHS,
    SIBLING_STAGGER,
} from "../constants";

/* ------------------------------- Test fixture ------------------------------ */

const res = (id: string): TreeNode => ({ id: `res:${id}`, name: id, kind: "resource", url: `https://x.io/${id}` });
const cat = (id: string, children?: TreeNode[]): TreeNode => ({
    id: `cat:${id}`,
    name: id,
    kind: "category",
    count: children?.length ?? 0,
    children,
});
const rootOf = (children: TreeNode[]): TreeNode => ({ id: "osint-root", name: "Root", kind: "root", children });

const byId = (layout: TreeLayout, id: string) => layout.nodes.find((n) => n.data.id === id)!;
// Position of a node's box in SVG coordinates
const pos = (layout: TreeLayout, id: string) => {
    const n = byId(layout, id);
    return { x: n.y + layout.offsetX, y: n.x + layout.offsetY };
};

// root ── a (a1, a2) ── b (b1), both expanded
const expandedTree = () => rootOf([cat("a", [res("a1"), res("a2")]), cat("b", [res("b1")])]);
// the same tree with both categories collapsed
const collapsedTree = () => rootOf([cat("a"), cat("b")]);

const NONE: ReadonlySet<string> = new Set();

/* ------------------------------ Initial render ----------------------------- */

describe("computeLayout on the first render (nothing on screen yet)", () => {
    const layout = computeLayout(expandedTree(), NONE);

    it("uses the long intro link duration", () => {
        expect(layout.linkDuration).toBe(LINK_DURATION);
    });

    it("gives every node except the root an enter entry", () => {
        expect(layout.enter.has("osint-root")).toBe(false);
        for (const id of ["cat:a", "cat:b", "res:a1", "res:a2", "res:b1"]) {
            expect(layout.enter.has(id)).toBe(true);
        }
    });

    it("staggers sibling categories after the root", () => {
        expect(layout.enter.get("cat:a")!.delay).toBeCloseTo(BRANCH_GAP);
        expect(layout.enter.get("cat:b")!.delay).toBeCloseTo(BRANCH_GAP + SIBLING_STAGGER);
    });

    it("starts a category's resources once the category has arrived", () => {
        const catArrival = BRANCH_GAP + LINK_DURATION; // cat:a started at BRANCH_GAP and takes LINK_DURATION
        expect(layout.enter.get("res:a1")!.delay).toBeCloseTo(catArrival + BRANCH_GAP);
        expect(layout.enter.get("res:a2")!.delay).toBeCloseTo(catArrival + BRANCH_GAP + SIBLING_STAGGER);
    });

    it("moves each node for as long as its link takes to draw", () => {
        for (const entry of layout.enter.values()) expect(entry.duration).toBe(LINK_DURATION);
    });

    it("unfolds categories from the root's right edge", () => {
        const root = pos(layout, "osint-root");
        expect(layout.enter.get("cat:a")!.from).toEqual({ x: root.x + NODE_WIDTHS.root, y: root.y });
    });

    it("unfolds resources from their category's right edge", () => {
        const category = pos(layout, "cat:a");
        expect(layout.enter.get("res:a1")!.from).toEqual({ x: category.x + NODE_WIDTHS.category, y: category.y });
    });

    it("records link start times that match the enter delays", () => {
        for (const [id, entry] of layout.enter) expect(layout.linkStarts.get(id)).toBe(entry.delay);
    });
});

/* ------------------------------- Later updates ----------------------------- */

describe("computeLayout on later updates", () => {
    // root and both categories are already on screen; category a was just expanded
    const onScreen: ReadonlySet<string> = new Set(["osint-root", "cat:a", "cat:b"]);
    const layout = computeLayout(expandedTree(), onScreen);

    it("only gives new nodes an enter entry", () => {
        expect([...layout.enter.keys()].sort()).toEqual(["res:a1", "res:a2", "res:b1"]);
    });

    it("adds no delay for nodes already on screen", () => {
        for (const id of ["cat:a", "cat:b"]) expect(layout.linkStarts.get(id)).toBe(0);
    });

    it("uses the shorter link duration", () => {
        expect(layout.linkDuration).toBe(LINK_DURATION_UPDATE);
        expect(layout.enter.get("res:a1")!.duration).toBe(LINK_DURATION_UPDATE);
    });

    it("times new nodes from their visible parent, not from the root", () => {
        expect(layout.enter.get("res:a1")!.delay).toBeCloseTo(BRANCH_GAP);
        expect(layout.enter.get("res:a2")!.delay).toBeCloseTo(BRANCH_GAP + SIBLING_STAGGER);
        // b1 is the first new child of its own parent, so its stagger starts over
        expect(layout.enter.get("res:b1")!.delay).toBeCloseTo(BRANCH_GAP);
    });

    it("counts only new siblings towards the stagger", () => {
        // a1 is already on screen, so a2 is the first *new* sibling
        const withA1 = computeLayout(expandedTree(), new Set([...onScreen, "res:a1"]));
        expect(withA1.enter.has("res:a1")).toBe(false);
        expect(withA1.enter.get("res:a2")!.delay).toBeCloseTo(BRANCH_GAP);
    });

    it("has no enter entries when nothing is new", () => {
        const all = new Set(["osint-root", "cat:a", "cat:b", "res:a1", "res:a2", "res:b1"]);
        expect(computeLayout(expandedTree(), all).enter.size).toBe(0);
    });
});

describe("computeLayout stagger cap", () => {
    it("stops adding delay after MAX_STAGGER_ITEMS siblings", () => {
        const many = Array.from({ length: MAX_STAGGER_ITEMS + 5 }, (_, i) => res(`r${i}`));
        const layout = computeLayout(rootOf([cat("big", many)]), new Set(["osint-root", "cat:big"]));

        const last = layout.enter.get(`res:r${MAX_STAGGER_ITEMS + 4}`)!.delay;
        const atCap = layout.enter.get(`res:r${MAX_STAGGER_ITEMS}`)!.delay;
        expect(last).toBeCloseTo(BRANCH_GAP + MAX_STAGGER_ITEMS * SIBLING_STAGGER);
        expect(atCap).toBeCloseTo(last);
    });
});

/* ------------------------------ Reduced motion ----------------------------- */

describe("computeLayout with reduced motion", () => {
    const layout = computeLayout(expandedTree(), NONE, true);

    it("removes every delay and duration", () => {
        expect(layout.linkDuration).toBe(0);
        for (const entry of layout.enter.values()) {
            expect(entry.delay).toBe(0);
            expect(entry.duration).toBe(0);
        }
        for (const start of layout.linkStarts.values()) expect(start).toBe(0);
    });

    it("does not unfold: nodes start at their own position", () => {
        for (const [id, entry] of layout.enter) expect(entry.from).toEqual(pos(layout, id));
    });
});

/* ---------------------------- Size, links, spacing --------------------------- */

describe("computeLayout geometry", () => {
    it("makes the SVG just wide enough for the rightmost node", () => {
        const layout = computeLayout(expandedTree(), NONE);
        // resources are the rightmost nodes: two columns in + one resource box
        expect(layout.width).toBe(2 * 250 + NODE_WIDTHS.resource + MARGIN.left + MARGIN.right);
    });

    it("sizes a root-only tree to the root box", () => {
        const layout = computeLayout(rootOf([]), NONE);
        expect(layout.width).toBe(NODE_WIDTHS.root + MARGIN.left + MARGIN.right);
    });

    it("sizes a tree with only categories to the category column", () => {
        const layout = computeLayout(collapsedTree(), NONE);
        expect(layout.width).toBe(250 + NODE_WIDTHS.category + MARGIN.left + MARGIN.right);
    });

    it("keeps every node inside the top margin", () => {
        const layout = computeLayout(expandedTree(), NONE);
        for (const n of layout.nodes) expect(n.x + layout.offsetY).toBeGreaterThanOrEqual(MARGIN.top);
        expect(layout.height).toBeGreaterThan(MARGIN.top + MARGIN.bottom);
    });

    it("attaches links to the source's right edge and the target's left edge", () => {
        const layout = computeLayout(expandedTree(), NONE);
        const link = layout.links.find((l) => l.target.data.id === "res:a1")!;
        const source = pos(layout, "cat:a");
        const target = pos(layout, "res:a1");

        const sx = source.x + NODE_WIDTHS.category;
        const mid = (sx + target.x) / 2;
        expect(layout.pathFor(link.source, link.target)).toBe(
            `M ${sx} ${source.y} C ${mid} ${source.y}, ${mid} ${target.y}, ${target.x} ${target.y}`
        );
    });

    it("anchors links from the root at the root's width", () => {
        const layout = computeLayout(collapsedTree(), NONE);
        const link = layout.links.find((l) => l.target.data.id === "cat:a")!;
        expect(layout.pathFor(link.source, link.target).startsWith(`M ${MARGIN.left + NODE_WIDTHS.root} `)).toBe(true);
    });

    it("spaces siblings by one unit and different parents by GROUP_SEPARATION", () => {
        const layout = computeLayout(expandedTree(), NONE);
        // a1 and a2 share a parent; a2 and b1 do not
        expect(byId(layout, "res:a2").x - byId(layout, "res:a1").x).toBeCloseTo(NODE_HEIGHT);
        expect(byId(layout, "res:b1").x - byId(layout, "res:a2").x).toBeCloseTo(NODE_HEIGHT * GROUP_SEPARATION);
    });
});
