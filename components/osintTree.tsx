"use client";

import { Dispatch, SetStateAction, useMemo, useState } from "react";
import { hierarchy, tree, type HierarchyPointNode } from "d3-hierarchy";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "./ui/drawer";
import { Button, buttonVariants } from "./ui/button";
import { ModeToggle } from "./toggleTheme";
import { motion } from "motion/react";
import { Badge } from "./ui/badge";
import { Copy } from "lucide-react";

type Resource = {
    id: string;
    name: string;
    url: string;
    description?: string;
    tags?: string[];
    bestFor?: string;
    caution?: string;
};

type Category = {
    id: string;
    name: string;
    description?: string;
    resources: Resource[];
};

type OsintData = {
    title?: string;
    version?: number;
    description?: string;
    categories: Category[];
};

type TreeNode = {
    id: string;
    name: string;
    kind: "root" | "category" | "resource";
    url?: string;
    description?: string;
    tags?: string[];
    bestFor?: string;
    caution?: string;
    count?: number;
    children?: TreeNode[];
};

type Props = { data: OsintData };


type ResourceDrawerProps = {
    selectedResource: HierarchyPointNode<TreeNode> | null;
    setSelectedResource: Dispatch<
        SetStateAction<HierarchyPointNode<TreeNode> | null>
    >;
};

const NODE_HEIGHT = 42;
const HORIZONTAL_GAP = 250;
const MARGIN = { top: 28, right: 32, bottom: 28, left: 24 };
const SNAP_POINTS = ["31rem", 1]
const LINK_DURATION = 0.45;
const BRANCH_GAP = 0.02;


function ResourceDrawer({ selectedResource, setSelectedResource }: ResourceDrawerProps) {
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
            onOpenChange={(open) => {
                if (!open) setSelectedResource(null);
            }}
        >
            <DrawerContent >
                <DrawerHeader className="items-center">
                    <DrawerTitle className="text-2xl">
                        {selectedResource?.data.name}
                    </DrawerTitle>

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

                    <div className="flex flex-wrap justify-center gap-3 pt-3">
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
                            Go to Link
                        </a>

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
                    </div>
                </DrawerHeader>

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

                    {/* Best for */}
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

                    {/* Caution */}
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
        </Drawer>
    )
}


export default function OsintTree({ data }: Props) {
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const resetTree = () => {
        setExpanded({});
        setQuery("");
    };
    const [query, setQuery] = useState("");
    const search = query.trim().toLowerCase();
    const [selectedResource, setSelectedResource] = useState<HierarchyPointNode<TreeNode> | null>(null)

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

    const visibleData = useMemo<TreeNode>(() => {
        const filterResources = (node: TreeNode): TreeNode | null => {
            if (node.kind === "resource") {
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

                return !search || haystack.includes(search) ? { ...node, children: undefined } : null;
            }

            const children = (node.children || [])
                .map(filterResources)
                .filter((child): child is TreeNode => child !== null
                );


            if (node.kind === "root") return { ...node, children };

            if (search) return children.length ? { ...node, children } : null;

            return {
                ...node,
                children: expanded[node.id] ? children : undefined,
            };
        };

        return filterResources(rootData) || { ...rootData, children: [] };
    }, [rootData, expanded, search]);

    const layout = useMemo(() => {

        const root = hierarchy<TreeNode>(visibleData, (node) => node.children);
        const positionedRoot = tree<TreeNode>().nodeSize([NODE_HEIGHT, HORIZONTAL_GAP])(root);
        const nodes = positionedRoot.descendants();
        const links = positionedRoot.links();


        const revealTimes = new Map<string, number>();
        revealTimes.set(positionedRoot.data.id, 0);

        positionedRoot.eachBefore((node) => {
            const parentRevealTime = revealTimes.get(node.data.id) ?? 0;

            for (const child of node.children ?? []) {
                const linkStart = parentRevealTime + BRANCH_GAP;
                const childRevealTime = linkStart + LINK_DURATION;

                revealTimes.set(child.data.id, childRevealTime);
            }
        });


        const minX = Math.min(0, ...nodes.map((node) => node.x));
        const maxX = Math.max(0, ...nodes.map((node) => node.x));
        const maxY = Math.max(0, ...nodes.map((node) => node.y));

        return {
            nodes,
            links,
            revealTimes,
            width: maxY + MARGIN.left + MARGIN.right + 220,
            height: maxX - minX + MARGIN.top + MARGIN.bottom,
            offsetX: MARGIN.left,
            offsetY: MARGIN.top - minX,
        };
    }, [visibleData]);

    const pathFor = (
        source: HierarchyPointNode<TreeNode>,
        target: HierarchyPointNode<TreeNode>
    ) => {
        const sx = source.y + layout.offsetX + (source.depth === 0 ? 158 : 190);
        const sy = source.x + layout.offsetY;
        const tx = target.y + layout.offsetX;
        const ty = target.x + layout.offsetY;
        const middle = (sx + tx) / 2;
        return `M ${sx} ${sy} C ${middle} ${sy}, ${middle} ${ty}, ${tx} ${ty}`;
    };


    return (
        <section className="w-full h-full space-y-3">
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
                        placeholder="Search resources..."
                        aria-label="Search OSINT resources"
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm sm:max-w-xs"
                    />
                    <ModeToggle />
                </div>
            </div>

            <div className="w-full overflow-auto h-full">
                <ResourceDrawer {...{ selectedResource, setSelectedResource }} />
                <svg
                    role="tree"
                    aria-label="OSINT resource tree"
                    width={layout.width}
                    height={layout.height}
                    viewBox={`0 0 ${layout.width} ${layout.height}`}
                    className="min-w-full"
                >
                    <g
                        fill="none"
                        stroke="currentColor"
                        strokeOpacity="0.3"
                        strokeWidth="1.4"
                    >
                        {layout.links.map((link) => {
                            const delay =
                                (layout.revealTimes.get(link.source.data.id) ?? 0) +
                                BRANCH_GAP;

                            return (
                                <motion.path
                                    key={`${link.source.data.id}-${link.target.data.id}`}
                                    d={pathFor(
                                        link.source as HierarchyPointNode<TreeNode>,
                                        link.target as HierarchyPointNode<TreeNode>
                                    )}
                                    initial={{ pathLength: 0, opacity: 0 }}
                                    animate={{ pathLength: 1, opacity: 1 }}
                                    transition={{
                                        duration: LINK_DURATION,
                                        delay,
                                        ease: "easeOut",
                                    }}
                                />
                            )
                        }


                        )}
                    </g>

                    {layout.nodes.map((node) => {
                        const item = node.data;
                        const x = node.y + layout.offsetX;
                        const y = node.x + layout.offsetY;
                        const isRoot = item.kind === "root";
                        const isCategory = item.kind === "category";
                        const isResource = item.kind === "resource";
                        const width = isRoot ? 158 : isCategory ? 190 : 210;
                        const isExpanded = Boolean(search || expanded[item.id]);
                        const nodeDelay = layout.revealTimes.get(item.id) ?? 0;

                        return (
                            <g role="button" tabIndex={0} key={item.id} transform={`translate(${x}, ${y})`}
                                onClick={() => {
                                    if (isResource && item.url) setSelectedResource(node)
                                }}

                            >
                                <motion.g
                                    initial={{ opacity: 0, scale: 0.96 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{
                                        duration: .2,
                                        delay: nodeDelay,
                                        ease: "easeOut",
                                    }}
                                    style={{
                                        transformBox: "fill-box",
                                        transformOrigin: "center",
                                    }}
                                >

                                    {isResource && item.url ? (
                                        <>
                                            <rect
                                                x="0"
                                                y="-16"
                                                width={width}
                                                height="34"
                                                rx="7"
                                                fill="var(--osint-resource-fill, #f8fafc)"
                                                stroke="var(--osint-resource-stroke, #cbd5e1)"
                                            />
                                            <text
                                                x="10"
                                                y="1"
                                                dominantBaseline="middle"
                                                fontSize="12"
                                                fill="var(--osint-resource-text, #334155)"
                                                pointerEvents="none"
                                            >
                                                {item.name.length > 27
                                                    ? `${item.name.slice(0, 26)}…`
                                                    : item.name}
                                            </text>
                                            <title>{`${item.name}\n${item.url}`}</title>
                                        </>
                                    ) : (
                                        <g
                                            role="treeitem"
                                            tabIndex={0}
                                            aria-expanded={isRoot ? true : isCategory ? isExpanded : undefined}
                                            className={isRoot || isCategory ? "cursor-pointer" : ""}
                                            onClick={() => {
                                                if (isCategory) {
                                                    setExpanded((current) => ({ ...current, [item.id]: !current[item.id] }));
                                                }
                                                else if (isRoot) {
                                                    resetTree()
                                                }
                                            }}
                                            onKeyDown={(event) => {
                                                if (isCategory && (event.key === "Enter" || event.key === " ")) {
                                                    event.preventDefault();
                                                    setExpanded((current) => ({ ...current, [item.id]: !current[item.id] }));
                                                }
                                                else if (isRoot) {
                                                    resetTree()
                                                }
                                            }}
                                        >
                                            <rect
                                                x="0" y="-16" width={width} height="34" rx="7"
                                                fill={isRoot
                                                    ? "var(--osint-root-fill, #0f172a)"
                                                    : "var(--osint-category-fill, #e2e8f0)"}
                                                stroke={isRoot
                                                    ? "var(--osint-root-stroke, #0f172a)"
                                                    : "var(--osint-category-stroke, #94a3b8)"}
                                            />
                                            <text
                                                x="10" y="1" dominantBaseline="middle" fontSize="12"
                                                fontWeight={isRoot ? 700 : 600}
                                                fill={isRoot
                                                    ? "var(--osint-root-text, #ffffff)"
                                                    : "var(--osint-category-text, #0f172a)"}
                                            >
                                                {isCategory && item.count ? `${isExpanded ? "▾" : "▸"} ` : ""}
                                                {item.name.length > (isRoot ? 20 : 25)
                                                    ? `${item.name.slice(0, isRoot ? 19 : 24)}…`
                                                    : item.name}
                                            </text>
                                            {isCategory && (
                                                <text
                                                    x={width - 10} y="1" textAnchor="end" dominantBaseline="middle"
                                                    fontSize="10" opacity="0.7"
                                                    fill="var(--osint-category-text, #0f172a)"
                                                >
                                                    {item.count}
                                                </text>
                                            )}
                                            <title>{item.description || item.name}</title>
                                        </g>
                                    )}
                                </motion.g>
                            </g>
                        );
                    })}
                </svg>
                {search && layout.nodes.length === 1 && (
                    <p className="p-4 text-sm text-muted-foreground">No matching resources found.</p>
                )}
            </div>
        </section>
    );
}
