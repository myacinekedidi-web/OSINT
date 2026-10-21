"use client";

import { useMemo, useState } from "react";
import type { HierarchyPointNode } from "d3-hierarchy";
import { motion } from "motion/react";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/toggleTheme";
import type { OsintData, TreeNode } from "./osint-tree/osint-types";
import { buildResourceIndex, buildTree } from "./osint-tree/build-tree";
import { filterTree, parseQuery, toggleFavoritesToken } from "./osint-tree/filter-tree";
import { useFavorites } from "./osint-tree/favorites";
import { useTreeLayout } from "./osint-tree/use-tree-layout";
import { ResourceDrawer } from "./osint-tree/resource-drawer";
import { TreeNodeView } from "./osint-tree/tree-node-view";
import { MOVE_TRANSITION } from "./osint-tree/constants";

type Props = { data: OsintData };

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
    const layout = useTreeLayout(visibleData);

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

    return (
        <section className="w-full h-full space-y-3">
            {/* Header: title, help text, search box, favorites toggle and theme toggle */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between px-2 py-1">
                <div>
                    <h2 className="text-lg font-semibold">{data.title || "OSINT Resources"}</h2>
                    <p className="text-sm text-muted-foreground">
                        Expand categories to explore resources, or search by name or URL.
                    </p>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <input
                        name="searchByResource"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search resources or @favorites [term]..."
                        aria-label="Search OSINT resources"
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm sm:w-80 sm:max-w-none"
                    />
                    {/* Toggles the favorites filter: adds/removes "@favorites" in the input and keeps
                        any other text. Shown as pressed (filled star) while the filter is active. */}
                    <Button
                        variant={favoritesOnly ? "secondary" : "outline"}
                        size="sm"
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
                    favorites={favorites}
                    toggleFavorite={toggleFavorite}
                />
                <svg
                    role="tree"
                    aria-label="OSINT resource tree"
                    width={layout.width}
                    height={layout.height}
                    viewBox={`0 0 ${layout.width} ${layout.height}`}
                    className="min-w-full"
                >
                    {/* Links: curved lines from parent to child, drawn in progressively */}
                    <g
                        fill="none"
                        stroke="currentColor"
                        strokeOpacity="0.3"
                        strokeWidth="1.4"
                    >
                        {layout.links.map((link) => {
                            // Each link has its own start time (parent reveal + gap + sibling stagger);
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
                                    transition={{
                                        pathLength: { duration: layout.linkDuration, delay, ease: "easeOut" },
                                        opacity: { duration: layout.linkDuration, delay, ease: "easeOut" },
                                        d: MOVE_TRANSITION,
                                    }}
                                />
                            );
                        })}
                    </g>

                    {/* Nodes: root, category and resource boxes */}
                    {layout.nodes.map((node) => (
                        <TreeNodeView
                            key={node.data.id}
                            node={node}
                            // d3 lays the tree out top-down, so its y is our horizontal position and x our vertical
                            x={node.y + layout.offsetX}
                            y={node.x + layout.offsetY}
                            // Fade-in delay so nodes appear once their incoming link has been drawn
                            revealDelay={layout.revealTimes.get(node.data.id) ?? 0}
                            // Categories always appear expanded while a search is active
                            isExpanded={hasQuery || Boolean(expanded[node.data.id])}
                            onActivate={handleActivate}
                        />
                    ))}
                </svg>
                {/* Empty state: only the root is left, so nothing matched the search */}
                {hasQuery && layout.nodes.length === 1 && (
                    <p className="p-4 text-sm text-muted-foreground">
                        {favoritesOnly && favorites.size === 0
                            ? "No favorites yet. Open a resource and use Add to Favorites."
                            : "No matching resources found."}
                    </p>
                )}
            </div>
        </section>
    );
}
