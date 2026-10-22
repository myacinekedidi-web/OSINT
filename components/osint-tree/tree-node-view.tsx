import type { KeyboardEvent } from "react";
import { motion } from "motion/react";
import type { HierarchyPointNode } from "d3-hierarchy";
import type { TreeNode } from "./osint-types";
import { MOVE_TRANSITION, NODE_BOX, NODE_BOX_CENTER_Y, NODE_WIDTHS } from "./constants";

type TreeNodeViewProps = {
    node: HierarchyPointNode<TreeNode>;
    /** Position of the node's box in SVG coordinates. */
    x: number;
    y: number;
    /** Seconds to wait before the node fades in (so it appears once its incoming link is drawn). */
    revealDelay: number;
    /** Whether a category is shown expanded (also true while searching). */
    isExpanded: boolean;
    /** Called on click, Enter or Space. The parent decides what the node does (open, toggle, reset). */
    onActivate: (node: HierarchyPointNode<TreeNode>) => void;
};

/**
 * Draws one node of the tree (root, category or resource): its box, label and focus ring.
 * Each node is a single tab stop that is activated by click, Enter or Space.
 */
export function TreeNodeView({ node, x, y, revealDelay, isExpanded, onActivate }: TreeNodeViewProps) {
    const item = node.data;
    const isRoot = item.kind === "root";
    const isCategory = item.kind === "category";
    const isResource = item.kind === "resource";
    const width = NODE_WIDTHS[item.kind];

    // Category badge: "matched/total" while filtering (e.g. "2/4"), otherwise just the total
    const countLabel = isCategory
        ? item.matchedCount !== undefined
            ? `${item.matchedCount}/${item.count}`
            : `${item.count}`
        : "";

    // Tooltip for root/category nodes. Categories add a count line to their description.
    const tooltip = isCategory
        ? [
            item.description || item.name,
            item.matchedCount !== undefined
                ? `${item.matchedCount} of ${item.count} resources match.`
                : `${item.count} ${item.count === 1 ? "resource" : "resources"}.`,
        ].join("\n")
        : item.description || item.name;

    const activate = () => onActivate(node);

    // Keyboard accessibility: Enter or Space does the same as a click
    const handleKeyDown = (event: KeyboardEvent<SVGGElement>) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault(); // stop Space from scrolling the page
        activate();
    };

    return (
        // Outer group animates the node's position when the layout shifts
        // (starting at its final position, so new nodes don't fly in from the
        // origin); the inner motion.g handles the fade/scale-in, and each
        // node's own <g> handles focus, clicks and keyboard input.
        <motion.g
            initial={{ x, y }}
            animate={{ x, y }}
            transition={MOVE_TRANSITION}
        >
            <motion.g
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                    duration: 0.2,
                    delay: revealDelay,
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
                        onClick={activate}
                        onKeyDown={handleKeyDown}
                    >
                        <rect
                            x="0"
                            y={NODE_BOX.top}
                            width={width}
                            height={NODE_BOX.height}
                            rx={NODE_BOX.radius}
                            fill="var(--osint-resource-fill, #f8fafc)"
                            stroke="var(--osint-resource-stroke, #cbd5e1)"
                            // Visible focus ring for keyboard users
                            className="group-focus-visible:stroke-blue-500 group-focus-visible:stroke-2"
                        />
                        <text
                            x="10"
                            y={NODE_BOX_CENTER_Y}
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
                        onClick={activate}
                        onKeyDown={handleKeyDown}
                    >
                        <rect
                            x="0"
                            y={NODE_BOX.top}
                            width={width}
                            height={NODE_BOX.height}
                            rx={NODE_BOX.radius}
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
                            x="10"
                            y={NODE_BOX_CENTER_Y}
                            dominantBaseline="middle"
                            fontSize="12"
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
                                x={width - 10}
                                y={NODE_BOX_CENTER_Y}
                                textAnchor="end"
                                dominantBaseline="middle"
                                fontSize="10"
                                opacity="0.7"
                                fill="var(--osint-category-text, #0f172a)"
                            >
                                {countLabel}
                            </text>
                        )}
                        {/* Native tooltip with the description (and, for categories, how many resources match) */}
                        <title>{tooltip}</title>
                    </g>
                )}
            </motion.g>
        </motion.g>
    );
}
