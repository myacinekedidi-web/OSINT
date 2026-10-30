"use client";

import { useMemo, useRef, useState } from "react";
import type { HierarchyPointNode } from "d3-hierarchy";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/toggleTheme";
import type { OsintData, TreeNode } from "./osint-tree/osint-types";
import { buildResourceIndex, buildTree } from "./osint-tree/build-tree";
import { filterTree, parseQuery, toggleFavoritesToken } from "./osint-tree/filter-tree";
import { useFavorites } from "./osint-tree/favorites";
import { useTreeLayout } from "./osint-tree/use-tree-layout";
import { getSearchStatus } from "./osint-tree/search-status";
import { SearchBox } from "./osint-tree/search-box";
import { ResourceDrawer } from "./osint-tree/resource-drawer";
import { NodeDefs, TreeNodeView } from "./osint-tree/tree-node-view";
import { EXIT_DURATION, INSTANT, MOVE_TRANSITION } from "./osint-tree/constants";



type Props = { data: OsintData };

// Id of the live region that reports search results (referenced by the search input)
const SEARCH_STATUS_ID = "search-status";

/**
 * Interactive, horizontally-laid-out tree of OSINT resources.
 *  - Click a category to expand/collapse it; click the root to reset.
 *  - Click a resource to open its details drawer.
 *  - Search filters resources. The star toggle (or starting the query with
 *    "@favorites") shows only favorited resources, optionally narrowed by a search term.
 */
export default function OsintTree({ data }: Props) {
    // Maps category id -> whether it is expanded (ignored while searching)
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [query, setQuery] = useState("");
    // The raw input broken into favorites flag + search text (re-parsed only when the input changes)
    const parsedQuery = useMemo(() => parseQuery(query), [query]);
    // hasQuery: anything is being filtered (some text, or the @favorites token)
    // favoritesOnly: the @favorites token is present (drives the star toggle)
    const { hasQuery, favoritesOnly } = parsedQuery;
    // Id of the resource shown in the drawer. It is deliberately NOT cleared when the drawer
    // closes, so the content stays on screen during the closing animation.
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const { favorites, toggleFavorite } = useFavorites();
    // True when the user's system asks for less motion: nothing is delayed, moved or animated
    const reduceMotion = useReducedMotion() ?? false;
    const svgRef = useRef<SVGSVGElement>(null);

    // The full tree built from the raw data, and a lookup table over its resources
    // (id -> resource + path from the root). Both only change when `data` does.
    const rootData = useMemo(() => buildTree(data), [data]);
    const resourceIndex = useMemo(() => buildResourceIndex(rootData), [rootData]);

    // The resource currently selected for the drawer, if any
    const selected = selectedId ? resourceIndex.get(selectedId) : undefined;

    // The subtree that should currently be displayed, based on the search query /
    // "@favorites" filter and which categories are expanded (see filter-tree.ts).
    const visibleData = useMemo<TreeNode>(
        () => filterTree(rootData, parsedQuery, { favorites, expanded }),
        [rootData, parsedQuery, favorites, expanded]
    );

    // Node positions, links, animation timing and SVG size for the visible tree
    const layout = useTreeLayout(visibleData, reduceMotion);

    // Result count / empty-state text for the live region below
    const searchStatus = getSearchStatus({
        hasQuery,
        resourceCount: layout.nodes.filter((node) => node.data.kind === "resource").length,
        favoritesOnly,
        favoritesCount: favorites.size,
    });

    // Collapses everything and clears the search box
    const resetTree = () => {
        setExpanded({});
        setQuery("");
    };

    const toggleCategory = (id: string) =>
        setExpanded((current) => ({ ...current, [id]: !current[id] }));

    // Opens the details drawer for a resource (only if it has a URL)
    const openResource = (item: TreeNode) => {
        if (!item.url) return;
        setSelectedId(item.id);
        setDrawerOpen(true);
    };

    // What a node does when activated (click, Enter or Space): resources open the
    // drawer, categories toggle open/closed, and the root resets the whole tree.
    const handleActivate = (node: HierarchyPointNode<TreeNode>) => {
        const item = node.data;
        switch (item.kind) {
            case "resource":
                openResource(item);
                break;
            case "category":
                toggleCategory(item.id);
                break;
            case "root":
                resetTree();
                break;
        }
    };

    // Called by the drawer once it has finished closing. Base UI only returns focus to HTML
    // elements and our nodes are SVG, so we focus the node ourselves: the one that opened the
    // drawer, or its category if that node is gone (e.g. the resource was un-favorited while the
    // favorites filter is on). Returning false tells Base UI to leave focus alone; returning true
    // falls back to its default behavior when there is nothing of ours to focus.
    const restoreFocus = (): boolean => {
        const svg = svgRef.current;
        if (!svg || !selected) return true;

        // Skip nodes that are fading out: they are about to disappear
        const elements = Array.from(
            svg.querySelectorAll<SVGElement>('[data-node-id]:not([aria-hidden="true"])')
        );
        const findNode = (id: string) => elements.find((el) => el.getAttribute("data-node-id") === id);

        // The path is [root, category, resource]
        const categoryId = selected.path[1]?.id;
        const target = findNode(selected.node.id) ?? (categoryId ? findNode(categoryId) : undefined);
        if (!target) return true;

        // Base UI finishes its own close cleanup in a microtask, so focus after it
        queueMicrotask(() => target.focus());
        return false;
    };

    return (
        <section className="w-full h-full space-y-3">
            {/* Header: title, help text, search box, favorites toggle and theme toggle */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between px-2 py-1">
                <div>
                    <h1 className="text-lg font-semibold">{data.title || "OSINT Resources"}</h1>
                    <p className="text-sm text-muted-foreground">
                        Expand categories to explore resources, or search by name or URL.
                    </p>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <SearchBox value={query} onChange={setQuery} describedBy={SEARCH_STATUS_ID} />
                    {/* Toggles the favorites filter: adds/removes "@favorites" in the input and keeps
                        any other text. Shown as pressed (filled star) while the filter is active. */}
                    <Button
                        variant={favoritesOnly ? "secondary" : "outline"}
                        size="icon"
                        aria-pressed={favoritesOnly}
                        onClick={() => setQuery(toggleFavoritesToken(query))}
                    >
                        <Star
                            className={`h-[1.2rem] w-[1.2rem] ${favoritesOnly ? "fill-yellow-400 text-yellow-400" : ""}`}
                        />
                        <span className="sr-only">Show only your favorites</span>
                    </Button>
                    <ModeToggle />
                </div>
            </div>

            {/* Scrollable canvas: the tree can be wider/taller than the viewport */}
            <div className="w-full overflow-auto h-full">
                <ResourceDrawer
                    resource={selected?.node ?? null}
                    breadcrumbs={selected?.path ?? []}
                    open={drawerOpen}
                    onOpenChange={setDrawerOpen}
                    finalFocus={restoreFocus}
                    favorites={favorites}
                    toggleFavorite={toggleFavorite}
                />
                <svg
                    ref={svgRef}
                    role="tree"
                    aria-label="OSINT resource tree"
                    width={layout.width}
                    height={layout.height}
                    viewBox={`0 0 ${layout.width} ${layout.height}`}
                    className="min-w-full"
                >
                    <NodeDefs />

                    {/* Links: curved lines from parent to child, drawn in progressively.
                        Purely decorative, so hidden from assistive technology. */}
                    <g
                        aria-hidden="true"
                        fill="none"
                        stroke="currentColor"
                        strokeOpacity="0.3"
                        strokeWidth="1.4"
                    >
                        <AnimatePresence>
                            {layout.links.map((link) => {
                                // Each link has its own start time (parent arrival + gap + sibling stagger);
                                // links into nodes that are already on screen start at 0
                                const delay = layout.linkStarts.get(link.target.data.id) ?? 0;
                                // SVG path data for this link's curve
                                const d = layout.pathFor(link.source, link.target);

                                return (
                                    <motion.path
                                        key={`${link.source.data.id}-${link.target.data.id}`}
                                        // Draw in from nothing; `d` is in initial too so new links start
                                        // at their final shape, and later changes to `d` animate the curve
                                        // as its nodes move.
                                        initial={{ pathLength: 0, opacity: 0, d }}
                                        animate={{ pathLength: 1, opacity: 1, d }}
                                        // Removed links fade out
                                        exit={{ opacity: 0, transition: { duration: reduceMotion ? 0 : EXIT_DURATION } }}
                                        transition={{
                                            pathLength: { duration: layout.linkDuration, delay, ease: "easeOut" },
                                            opacity: { duration: layout.linkDuration, delay, ease: "easeOut" },
                                            d: reduceMotion ? INSTANT : MOVE_TRANSITION,
                                        }}
                                    />
                                );
                            })}
                        </AnimatePresence>
                    </g>

                    {/* Nodes: root, category and resource boxes. Removed nodes fade out. */}
                    <AnimatePresence>
                        {layout.nodes.map((node) => (
                            <TreeNodeView
                                key={node.data.id}
                                node={node}
                                // d3 lays the tree out top-down, so its y is our horizontal position and x our vertical
                                x={node.y + layout.offsetX}
                                y={node.x + layout.offsetY}
                                // Only new nodes: where they unfold from and when they start moving
                                enter={layout.enter.get(node.data.id)}
                                // Categories always appear expanded while a search is active
                                isExpanded={hasQuery || Boolean(expanded[node.data.id])}
                                onActivate={handleActivate}
                            />
                        ))}
                    </AnimatePresence>
                </svg>
                {/* Live region, always mounted so screen readers announce changes to it. It is
                    linked to the search input (aria-describedby). Visible only when nothing
                    matched; otherwise it just announces the result count. */}
                <p
                    id={SEARCH_STATUS_ID}
                    role="status"
                    className={searchStatus.isEmpty ? "p-4 text-sm text-muted-foreground" : "sr-only"}
                >
                    {searchStatus.message}
                </p>
            </div>
        </section>
    );
}
