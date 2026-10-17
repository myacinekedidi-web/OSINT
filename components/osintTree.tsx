"use client";

import { useMemo, useState } from "react";
import { hierarchy, tree, type HierarchyPointNode } from "d3-hierarchy";

type Resource = {
    id: string;
    name: string;
    url: string;
    description?: string;
    tags?: string[];
};

type Category = {
    id: string;
    name: string;
    description?: string;
    resources: Resource[];
};

type OsintData = {
    title?: string;
    categories: Category[];
};

type TreeNode = {
    id: string;
    name: string;
    kind: "root" | "category" | "resource";
    url?: string;
    description?: string;
    count?: number;
    children?: TreeNode[];
};

type Props = { data: OsintData };

const NODE_HEIGHT = 42;
const HORIZONTAL_GAP = 250;
const MARGIN = { top: 28, right: 32, bottom: 28, left: 24 };

export default function OsintTree({ data }: Props) {
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const resetTree = () => {
        setExpanded({});
        setQuery("");
    };
    const [query, setQuery] = useState("");
    const search = query.trim().toLowerCase();

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
            })),
        })),
    }), [data]);

    const visibleData = useMemo<TreeNode>(() => {
        const filterResources = (node: TreeNode): TreeNode | null => {
            if (node.kind === "resource") {
                const haystack = `${node.name} ${node.url || ""} ${node.description || ""}`.toLowerCase();
                return !search || haystack.includes(search) ? { ...node, children: undefined } : null;
            }

            const children = (node.children || [])
                .map(filterResources)
                .filter((child): child is TreeNode => child !== null);

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
        const minX = Math.min(0, ...nodes.map((node) => node.x));
        const maxX = Math.max(0, ...nodes.map((node) => node.x));
        const maxY = Math.max(0, ...nodes.map((node) => node.y));

        return {
            nodes,
            links,
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
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h2 className="text-lg font-semibold">{data.title || "OSINT Resources"}</h2>
                    <p className="text-sm text-muted-foreground">
                        Expand categories to explore resources, or search by name or URL.
                    </p>
                </div>
                <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search resources..."
                    aria-label="Search OSINT resources"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm sm:max-w-xs"
                />
            </div>

            <div className="w-full overflow-auto h-full">
                <svg
                    role="tree"
                    aria-label="OSINT resource tree"
                    width={layout.width}
                    height={layout.height}
                    viewBox={`0 0 ${layout.width} ${layout.height}`}
                    className="min-w-full"
                >
                    <g fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.4">
                        {layout.links.map((link) => (
                            <path
                                key={`${link.source.data.id}-${link.target.data.id}`}
                                d={pathFor(
                                    link.source as HierarchyPointNode<TreeNode>,
                                    link.target as HierarchyPointNode<TreeNode>
                                )}
                            />
                        ))}
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

                        return (
                            <g key={item.id} transform={`translate(${x}, ${y})`}>
                                {isResource && item.url ? (
                                    <a href={item.url} target="_blank" rel="noopener noreferrer">
                                        <rect
                                            x="0" y="-16" width={width} height="34" rx="7"
                                            fill="var(--osint-resource-fill, #f8fafc)"
                                            stroke="var(--osint-resource-stroke, #cbd5e1)"
                                        />
                                        <text
                                            x="10" y="1" dominantBaseline="middle" fontSize="12"
                                            fill="var(--osint-resource-text, #334155)"
                                        >
                                            {item.name.length > 27 ? `${item.name.slice(0, 26)}…` : item.name}
                                        </text>
                                        <title>{`${item.name}\n${item.url}`}</title>
                                    </a>
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
