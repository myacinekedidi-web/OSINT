"use client";

import { Dispatch, SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import { hierarchy, tree, type HierarchyPointNode } from "d3-hierarchy";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "./ui/drawer";
import { Button, buttonVariants } from "./ui/button";
import { ModeToggle } from "./toggleTheme";
import { motion } from "motion/react";
import { Badge } from "./ui/badge";
import { Copy, ExternalLink, Star } from "lucide-react";

/* -------------------------------------------------------------------------- */
/*                                    Types                                   */
/* -------------------------------------------------------------------------- */

/** A single OSINT resource (a leaf in the tree), as provided by the data source. */
type Resource = {
    id: string;
    name: string;
    url: string;
    description?: string;
    tags?: string[];
    /** Short note on the use case this resource is best suited for. */
    bestFor?: string;
    /** Legal, ethical or reliability caveats shown to the user. */
    caution?: string;
};

/** A group of related resources (a branch in the tree). */
type Category = {
    id: string;
    name: string;
    description?: string;
    resources: Resource[];
};

/** Shape of the raw data passed into the component (e.g. from a JSON file). */
type OsintData = {
    title?: string;
    version?: number;
    description?: string;
    categories: Category[];
};

/**
 * Unified node type used by d3-hierarchy. Root, categories and resources all
 * share this shape so one tree can represent every level; `kind` tells them apart.
 * Resource-only fields (url, tags, bestFor, caution) are undefined on other kinds.
 */
type TreeNode = {
    id: string;
    name: string;
    kind: "root" | "category" | "resource";
    url?: string;
    description?: string;
    tags?: string[];
    bestFor?: string;
    caution?: string;
    /** Number of resources in a category (displayed as a badge on category nodes). */
    count?: number;
    children?: TreeNode[];
};

type Props = { data: OsintData };

type ResourceDrawerProps = {
    /** The node currently shown in the drawer, or null when the drawer is closed. */
    selectedResource: HierarchyPointNode<TreeNode> | null;
    setSelectedResource: Dispatch<
        SetStateAction<HierarchyPointNode<TreeNode> | null>
    >;
    /** Set of favorited resource ids. */
    favorites: Set<string>;
    toggleFavorite: (id: string) => Set<string> | void;
};

/* -------------------------------------------------------------------------- */
/*                                  Constants                                 */
/* -------------------------------------------------------------------------- */

// Tree layout (in px)
const NODE_HEIGHT = 42;        // vertical spacing between sibling nodes
const HORIZONTAL_GAP = 250;    // horizontal spacing between depth levels
const MARGIN = { top: 28, right: 32, bottom: 28, left: 24 };

// Drawer snap points: first stop at 31rem, second at full height (1 = 100%)
const SNAP_POINTS = ["31rem", 1];

// Animation timing (in seconds)
const LINK_DURATION = 0.45;         // how long a link takes to draw during the initial "grow from root" intro
const LINK_DURATION_UPDATE = 0.25;  // shorter link duration for later updates (expand, collapse, search)
const BRANCH_GAP = 0.02;            // small pause between a parent appearing and its links starting
const SIBLING_STAGGER = 0.03;       // extra delay per new sibling, so long lists cascade in
const MAX_STAGGER_ITEMS = 10;       // caps the cascade so large categories don't take too long (max 0.3s)

/* -------------------------------------------------------------------------- */
/*                                    Hooks                                   */
/* -------------------------------------------------------------------------- */

/**
 * Manages the set of favorited resource ids and keeps it in sync with
 * localStorage under the key "osint-favorites".
 */
function useFavorites() {
    const [favorites, setFavorites] = useState<Set<string>>(new Set());
    // Prevents the persist effect from overwriting stored data with the empty
    // initial set before the stored value has been read.
    const [favoritesLoaded, setFavoritesLoaded] = useState(false);

    // Load saved favorites once on mount (localStorage is only available in the browser)
    useEffect(() => {
        const stored = localStorage.getItem("osint-favorites");

        if (stored) {
            setFavorites(new Set<string>(JSON.parse(stored)));
        }

        setFavoritesLoaded(true);
    }, []);

    // Save favorites to localStorage whenever they change (after the initial load)
    useEffect(() => {
        if (!favoritesLoaded) return;

        localStorage.setItem(
            "osint-favorites",
            JSON.stringify([...favorites])
        );
    }, [favorites, favoritesLoaded]);

    // Adds the id if absent, removes it if present. Copies the Set so React sees a new reference.
    const toggleFavorite = (id: string) => {
        setFavorites((prev) => {
            const next = new Set(prev);

            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }

            return next;
        });
    };

    return { toggleFavorite, favorites }
}

/* -------------------------------------------------------------------------- */
/*                               Resource drawer                              */
/* -------------------------------------------------------------------------- */

/**
 * Bottom drawer showing the details of the selected resource: breadcrumb,
 * description, action buttons (open, copy URL, favorite), tags, "best for"
 * and cautions. Open state is derived from whether a resource is selected.
 */
function ResourceDrawer({
    selectedResource,
    setSelectedResource,
    favorites,
    toggleFavorite,
}: ResourceDrawerProps) {

    // Walks up the parent chain to build the path from root to the selected
    // node (e.g. Root · Category · Resource) for the breadcrumb display.
    const breadcrumbs = useMemo(() => {
        const path: TreeNode[] = [];
        let current = selectedResource;
        while (current) {
            path.unshift(current.data);
            current = current.parent;
        }

        return path;
    }, [selectedResource]);

    return (
        <Drawer
            snapPoints={SNAP_POINTS}
            showSwipeHandle
            open={selectedResource !== null}
            // Closing the drawer clears the selection
            onOpenChange={(open) => {
                if (!open) setSelectedResource(null);
            }}
        >
            <DrawerContent >
                <DrawerHeader className="items-center">
                    <DrawerTitle className="text-2xl">
                        {selectedResource?.data.name}
                    </DrawerTitle>

                    {/* Breadcrumb: the node's ancestors, separated by dots */}
                    <nav
                        className="text-xs pb-4 dark:text-amber-50"
                        aria-label="Breadcrumb"
                    >
                        {breadcrumbs.map((node, index) => (
                            <span
                                className="italic opacity-50"
                                key={node.id}
                            >
                                {index > 0 && " · "}
                                {node.name}
                            </span>
                        ))}
                    </nav>

                    <DrawerDescription className="max-w-2xl text-center font-mono text-[1.025rem] font-extralight">
                        {selectedResource?.data.description}
                    </DrawerDescription>

                    {/* Action buttons */}
                    <div className="flex flex-wrap justify-center gap-3 pt-3">

                        {/* Opens the resource in a new tab (noopener/noreferrer for security) */}
                        <a
                            href={selectedResource?.data.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={buttonVariants({
                                variant: "secondary",
                                size: "lg",
                                className: "bg-blue-600 px-8 py-4 hover:text-white hover:bg-blue-500",
                            })}
                        >
                            <ExternalLink />
                            Go to Link
                        </a>

                        {/* Copies the resource URL to the clipboard */}
                        {selectedResource?.data.url && (
                            <Button
                                variant="outline"
                                size="lg"
                                onClick={() => {
                                    navigator.clipboard.writeText(
                                        selectedResource.data.url!
                                    );
                                }}
                            >
                                <Copy className="mr-2 h-4 w-4" />
                                Copy URL
                            </Button>
                        )}

                        {/* Adds/removes the resource from favorites; the star is filled when favorited */}
                        {selectedResource?.data.id && (
                            <Button
                                variant="outline"
                                size="lg"
                                onClick={() => toggleFavorite(selectedResource.data.id)}
                            >
                                <Star
                                    className={`mr-2 h-4 w-4 ${favorites.has(selectedResource.data.id)
                                        ? "fill-yellow-400 text-yellow-400"
                                        : ""
                                        }`}
                                />
                                {favorites.has(selectedResource.data.id)
                                    ? "Remove from Favorites"
                                    : "Add to Favorites"}
                            </Button>
                        )}
                    </div>
                </DrawerHeader>

                {/* Scrollable details; each section only renders if its data exists */}
                <div className="flex-1 space-y-4 overflow-y-auto p-4 md:px-8">
                    {/* Tags */}
                    {selectedResource?.data.tags &&
                        selectedResource.data.tags.length > 0 && (
                            <section className="space-y-2">
                                <div className="flex flex-wrap gap-2">
                                    {selectedResource.data.tags.map((tag) => (
                                        <Badge
                                            variant="secondary"
                                            key={tag}
                                        >
                                            {tag}
                                        </Badge>
                                    ))}
                                </div>
                            </section>
                        )}

                    {/* Best for: the ideal use case */}
                    {selectedResource?.data.bestFor && (
                        <section className="rounded-xl border p-4">
                            <h3 className="mb-2 text-sm font-semibold">
                                Best for
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                {selectedResource.data.bestFor}
                            </p>
                        </section>
                    )}

                    {/* Considerations: caveats, highlighted with an amber tint */}
                    {selectedResource?.data.caution && (
                        <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                            <h3 className="mb-2 text-sm font-semibold">
                                Considerations
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                {selectedResource.data.caution}
                            </p>
                        </section>
                    )}
                </div>
            </DrawerContent>
        </Drawer >
    )
}

/* -------------------------------------------------------------------------- */
/*                                Main component                              */
/* -------------------------------------------------------------------------- */

/**
 * Interactive, horizontally-laid-out tree of OSINT resources.
 *  - Click a category to expand/collapse it; click the root to reset.
 *  - Click a resource to open its details drawer.
 *  - Search filters resources; prefix the query with "@favorites" to show
 *    only favorited resources (optionally followed by a search term).
 */
export default function OsintTree({ data }: Props) {
    // Maps category id -> whether it is expanded (ignored while searching)
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    // Collapses everything and clears the search box
    const resetTree = () => {
        setExpanded({});
        setQuery("");
    };
    const [query, setQuery] = useState("");
    // Normalized query used for matching
    const search = query.trim().toLowerCase();
    const [selectedResource, setSelectedResource] = useState<HierarchyPointNode<TreeNode> | null>(null)
    const { favorites, toggleFavorite } = useFavorites()
    // Ids of the nodes that were on screen after the last committed render.
    // Used to animate only newly added nodes; empty until the first render commits.
    const renderedIds = useRef<Set<string>>(new Set());

    // Converts the raw data (categories -> resources) into the TreeNode
    // hierarchy with a single root, so d3 can lay it out.
    const rootData = useMemo<TreeNode>(() => ({
        id: "osint-root",
        name: data.title || "OSINT Resources",
        kind: "root",
        children: (data.categories || []).map((category) => ({
            id: category.id,
            name: category.name,
            kind: "category" as const,
            description: category.description,
            count: category.resources?.length || 0,
            children: (category.resources || []).map((resource) => ({
                id: resource.id,
                name: resource.name,
                kind: "resource" as const,
                url: resource.url,
                description: resource.description,
                tags: resource.tags,
                bestFor: resource.bestFor,
                caution: resource.caution

            })),
        })),
    }), [data]);

    // Produces the subtree that should currently be displayed, based on:
    //  - the search query / "@favorites" filter
    //  - which categories are expanded
    // Recomputed whenever any of those inputs change.
    const visibleData = useMemo<TreeNode>(() => {
        // "@favorites" prefix restricts results to favorited resources;
        // whatever follows it is treated as the search term.
        const favoritesOnly = search.startsWith("@favorites");
        const searchTerm = favoritesOnly
            ? search.slice("@favorites".length).trim()
            : search;

        // Recursively filters a node. Returns null if the node should be hidden.
        const filterResources = (node: TreeNode): TreeNode | null => {
            // Leaf: keep it only if it passes both the favorites and text filters
            if (node.kind === "resource") {
                // Concatenate all searchable fields into one lowercase string
                const haystack = [
                    node.name,
                    node.url,
                    node.description,
                    ...(node.tags ?? []),
                    node.bestFor,
                    node.caution,
                ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();

                const matchesFavorites =
                    !favoritesOnly || favorites.has(node.id);

                const matchesSearch =
                    !searchTerm || haystack.includes(searchTerm);

                return matchesFavorites && matchesSearch
                    ? { ...node, children: undefined }
                    : null;


            }

            // Branch: filter children first, dropping the ones that don't match
            const children = (node.children || [])
                .map(filterResources)
                .filter((child): child is TreeNode => child !== null
                );

            // The root is always kept, even when it has no matching children
            if (node.kind === "root") return { ...node, children };

            // While searching, categories auto-expand but are hidden if nothing matches
            if (search) return children.length ? { ...node, children } : null;

            // Not searching: only show a category's children if the user expanded it
            return {
                ...node,
                children: expanded[node.id] ? children : undefined,
            };
        };
  
        return filterResources(rootData) || { ...rootData, children: [] };
    }, [rootData, expanded, search, favorites]);

    // Computes node positions and links with d3's tree layout, plus the
    // reveal timing for animations and the overall SVG dimensions.
    const layout = useMemo(() => {
        const root = hierarchy<TreeNode>(visibleData, (node) => node.children);
        // nodeSize([a, b]): `a` is spacing along d3's x axis (our vertical),
        // `b` is spacing along d3's y axis (our horizontal), since the tree grows left to right.
        const positionedRoot = tree<TreeNode>().nodeSize([NODE_HEIGHT, HORIZONTAL_GAP])(root);
        const nodes = positionedRoot.descendants();
        const links = positionedRoot.links();

        // Animation timing: a new node appears after the link from its parent
        // has finished drawing, so new branches "grow" outward.
        // Nodes already on screen don't re-animate, so they add no delay and
        // new nodes are timed from their nearest already-visible ancestor.
        // Nothing is on screen before the first render, so the intro still grows from the root.
        const isInitialRender = renderedIds.current.size === 0;
        const linkDuration = isInitialRender ? LINK_DURATION : LINK_DURATION_UPDATE;

        const revealTimes = new Map<string, number>(); // when each node fades in
        const linkStarts = new Map<string, number>();  // when the link into each node starts drawing
        revealTimes.set(positionedRoot.data.id, 0);
        // eachBefore visits parents before children, so a parent's time is always set first
        positionedRoot.eachBefore((node) => {
            const parentRevealTime = revealTimes.get(node.data.id) ?? 0;
            let newSiblingIndex = 0; // position among the *new* children only
            for (const child of node.children ?? []) {
                if (renderedIds.current.has(child.data.id)) {
                    // Already on screen: no animation, no delay
                    revealTimes.set(child.data.id, 0);
                    linkStarts.set(child.data.id, 0);
                    continue;
                }
                // Small per-sibling stagger (capped) so long lists cascade in
                const stagger = Math.min(newSiblingIndex++, MAX_STAGGER_ITEMS) * SIBLING_STAGGER;
                const linkStart = parentRevealTime + BRANCH_GAP + stagger;
                linkStarts.set(child.data.id, linkStart);
                revealTimes.set(child.data.id, linkStart + linkDuration);
            }
        });

        // Bounds of the layout. d3 centers the root at x = 0, so x can be negative;
        // that's why offsetY below shifts everything down by -minX.
        const minX = Math.min(0, ...nodes.map((node) => node.x));
        const maxX = Math.max(0, ...nodes.map((node) => node.x));
        const maxY = Math.max(0, ...nodes.map((node) => node.y));

        return {
            nodes,
            links,
            revealTimes,
            linkStarts,
            linkDuration,
            // 220 ≈ width of the widest (resource) node, so the last column isn't clipped
            width: maxY + MARGIN.left + MARGIN.right + 220,
            height: maxX - minX + MARGIN.top + MARGIN.bottom,
            offsetX: MARGIN.left,
            offsetY: MARGIN.top - minX,
        };
    }, [visibleData]);

    // After each committed render, remember which nodes are on screen so the
    // next layout only animates nodes that are actually new.
    useEffect(() => {
        renderedIds.current = new Set(layout.nodes.map((n) => n.data.id));
    }, [layout]);

    // Builds the SVG path (a smooth cubic Bézier) connecting a parent node's
    // right edge to a child node's left edge.
    const pathFor = (
        source: HierarchyPointNode<TreeNode>,
        target: HierarchyPointNode<TreeNode>
    ) => {
        // Start at the right edge of the source box (its width depends on node kind: root 158, category 190)
        const sx = source.y + layout.offsetX + (source.depth === 0 ? 158 : 190);
        const sy = source.x + layout.offsetY;
        // End at the left edge of the target box
        const tx = target.y + layout.offsetX;
        const ty = target.x + layout.offsetY;
        // Control points share the horizontal midpoint, giving an S-shaped curve
        const middle = (sx + tx) / 2;
        return `M ${sx} ${sy} C ${middle} ${sy}, ${middle} ${ty}, ${tx} ${ty}`;
    };

    // Opens the details drawer for a resource node (only if it has a URL)
    function handleClickOnResource(isResource: boolean, item: TreeNode, node: HierarchyPointNode<TreeNode>) {
        if (isResource && item.url) setSelectedResource(node)
    }

    // Categories toggle open/closed; the root resets the whole tree
    function handleClickOnCategoryOrRoot(
        isCategory: boolean,
        isRoot: boolean,
        id: string
    ) {
        if (isCategory) {
            setExpanded((current) => ({
                ...current,
                [id]: !current[id],
            }));
        } else if (isRoot) {
            resetTree();
        }
    }

    // Keyboard accessibility for every node kind: Enter or Space does the same as a click
    function handleKeyDown(
        event: React.KeyboardEvent<SVGGElement>,
        node: HierarchyPointNode<TreeNode>
    ) {
        if (event.key !== "Enter" && event.key !== " ") return;

        event.preventDefault(); // stop Space from scrolling the page
        const item = node.data;
        if (item.kind === "resource") {
            handleClickOnResource(true, item, node);
        } else {
            handleClickOnCategoryOrRoot(item.kind === "category", item.kind === "root", item.id);
        }
    }


    return (
        <section className="w-full h-full space-y-3">
            {/* Header: title, help text, search box, favorites shortcut and theme toggle */}
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
                    {/* Shortcut: fills the search box with "@favorites" */}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setQuery("@favorites")}
                    >
                        <Star className="h-[1.2rem] w-[1.2rem]" />
                        <span className="sr-only">Display only your favorites</span>

                    </Button>
                    <ModeToggle />
                </div>
            </div>

            {/* Scrollable canvas: the tree can be wider/taller than the viewport */}
            <div className="w-full overflow-auto h-full">
                <ResourceDrawer
                    selectedResource={selectedResource}
                    setSelectedResource={setSelectedResource}
                    favorites={favorites}
                    toggleFavorite={toggleFavorite} />
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

                            return (
                                <motion.path
                                    key={`${link.source.data.id}-${link.target.data.id}`}
                                    d={pathFor(
                                        link.source as HierarchyPointNode<TreeNode>,
                                        link.target as HierarchyPointNode<TreeNode>
                                    )}
                                    // Animate the stroke from nothing to fully drawn
                                    initial={{ pathLength: 0, opacity: 0 }}
                                    animate={{ pathLength: 1, opacity: 1 }}
                                    transition={{
                                        duration: layout.linkDuration,
                                        delay,
                                        ease: "easeOut",
                                    }}
                                />
                            )
                        }


                        )}
                    </g>

                    {/* Nodes: root, category and resource boxes */}
                    {layout.nodes.map((node) => {
                        const item = node.data;
                        // d3 lays the tree out top-down, so its y is our horizontal position and x our vertical
                        const x = node.y + layout.offsetX;
                        const y = node.x + layout.offsetY;
                        const isRoot = item.kind === "root";
                        const isCategory = item.kind === "category";
                        const isResource = item.kind === "resource";
                        // Box width per node kind (keep in sync with the widths used in pathFor)
                        const width = isRoot ? 158 : isCategory ? 190 : 210;
                        // Categories always appear expanded while a search is active
                        const isExpanded = Boolean(search || expanded[item.id]);
                        // Fade-in delay so nodes appear once their incoming link has been drawn
                        const nodeDelay = layout.revealTimes.get(item.id) ?? 0;

                        return (
                            // Outer group only handles positioning; the inner motion.g handles
                            // the fade/scale-in animation, and each node's own <g> handles
                            // focus, clicks and keyboard input.
                            <g key={item.id} transform={`translate(${x}, ${y})`}>
                                <motion.g
                                    initial={{ opacity: 0, scale: 0.96 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{
                                        duration: .2,
                                        delay: nodeDelay,
                                        ease: "easeOut",
                                    }}
                                    // Scale from the node's own center rather than the SVG origin
                                    style={{
                                        transformBox: "fill-box",
                                        transformOrigin: "center",
                                    }}
                                >

                                    {isResource && item.url ? (
                                        // Resource node: a single tab stop that opens the details drawer
                                        // on click, Enter or Space. `group` lets the rect react to focus.
                                        <g
                                            role="treeitem"
                                            tabIndex={0}
                                            aria-label={`${item.name}, opens details`}
                                            className="group cursor-pointer outline-none"
                                            onClick={() => handleClickOnResource(isResource, item, node)}
                                            onKeyDown={(event) => handleKeyDown(event, node)}
                                        >
                                            <rect
                                                x="0"
                                                y="-16"
                                                width={width}
                                                height="34"
                                                rx="7"
                                                fill="var(--osint-resource-fill, #f8fafc)"
                                                stroke="var(--osint-resource-stroke, #cbd5e1)"
                                                // Visible focus ring for keyboard users
                                                className="group-focus-visible:stroke-blue-500 group-focus-visible:stroke-2"
                                            />
                                            <text
                                                x="10"
                                                y="1"
                                                dominantBaseline="middle"
                                                fontSize="12"
                                                fill="var(--osint-resource-text, #334155)"
                                                pointerEvents="none"
                                            >
                                                {/* Truncate long names to fit inside the box */}
                                                {item.name.length > 27
                                                    ? `${item.name.slice(0, 26)}…`
                                                    : item.name}
                                            </text>
                                            {/* Native tooltip with full name and URL */}
                                            <title>{`${item.name}\n${item.url}`}</title>
                                        </g>
                                    ) : (
                                        // Root / category node: clickable and keyboard-accessible
                                        <g
                                            role="treeitem"
                                            tabIndex={0}
                                            aria-expanded={isRoot ? true : isCategory ? isExpanded : undefined}
                                            className={`group outline-none ${isRoot || isCategory ? "cursor-pointer" : ""}`}
                                            onClick={() => handleClickOnCategoryOrRoot(isCategory, isRoot, item.id)}
                                            onKeyDown={(event) => handleKeyDown(event, node)}
                                        >
                                            <rect
                                                x="0" y="-16" width={width} height="34" rx="7"
                                                fill={isRoot
                                                    ? "var(--osint-root-fill, #0f172a)"
                                                    : "var(--osint-category-fill, #e2e8f0)"}
                                                stroke={isRoot
                                                    ? "var(--osint-root-stroke, #0f172a)"
                                                    : "var(--osint-category-stroke, #94a3b8)"}
                                                // Visible focus ring for keyboard users
                                                className="group-focus-visible:stroke-blue-500 group-focus-visible:stroke-2"
                                            />
                                            <text
                                                x="10" y="1" dominantBaseline="middle" fontSize="12"
                                                fontWeight={isRoot ? 700 : 600}
                                                fill={isRoot
                                                    ? "var(--osint-root-text, #ffffff)"
                                                    : "var(--osint-category-text, #0f172a)"}
                                            >
                                                {/* Expand/collapse arrow (categories with resources only), then the truncated name */}
                                                {isCategory && item.count ? `${isExpanded ? "▾" : "▸"} ` : ""}
                                                {item.name.length > (isRoot ? 20 : 25)
                                                    ? `${item.name.slice(0, isRoot ? 19 : 24)}…`
                                                    : item.name}
                                            </text>
                                            {/* Resource count, right-aligned inside category boxes */}
                                            {isCategory && (
                                                <text
                                                    x={width - 10} y="1" textAnchor="end" dominantBaseline="middle"
                                                    fontSize="10" opacity="0.7"
                                                    fill="var(--osint-category-text, #0f172a)"
                                                >
                                                    {item.count}
                                                </text>
                                            )}
                                            {/* Native tooltip with the category description */}
                                            <title>{item.description || item.name}</title>
                                        </g>
                                    )}
                                </motion.g>
                            </g>
                        );
                    })}
                </svg>
                {/* Empty state: only the root is left, so nothing matched the search */}
                {search && layout.nodes.length === 1 && (
                    <p className="p-4 text-sm text-muted-foreground">No matching resources found.</p>
                )}
            </div>
        </section>
    );
}
