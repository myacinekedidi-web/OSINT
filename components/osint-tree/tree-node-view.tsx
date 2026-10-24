import type { KeyboardEvent } from "react";
import { motion, useIsPresent, useReducedMotion } from "motion/react";
import type { HierarchyPointNode } from "d3-hierarchy";
import type { TreeNode } from "./osint-types";
import type { NodeEnter } from "./compute-layout";
import {
    EXIT_DURATION,
    INSTANT,
    LABEL_PADDING,
    MOVE_TRANSITION,
    NODE_BOX,
    NODE_BOX_CENTER_Y,
    NODE_FADE_DURATION,
    NODE_WIDTHS,
    labelWidth,
    type NodeKind,
} from "./constants";

const NODE_KINDS = Object.keys(NODE_WIDTHS) as NodeKind[];

// Id of the clip path that limits a node's label to its label area
const labelClipId = (kind: NodeKind) => `osint-label-clip-${kind}`;

/**
 * Shared SVG definitions: one clip path per node kind, so long names are cut at the edge of
 * the label area (leaving room for the count badge in categories) instead of at a character
 * count. Render this once inside the <svg>.
 */
export function NodeDefs() {
    return (
        <defs>
            {NODE_KINDS.map((kind) => (
                <clipPath key={kind} id={labelClipId(kind)}>
                    <rect x={LABEL_PADDING} y={NODE_BOX.top} width={labelWidth(kind)} height={NODE_BOX.height} />
                </clipPath>
            ))}
        </defs>
    );
}

type TreeNodeViewProps = {
    node: HierarchyPointNode<TreeNode>;
    /** Position of the node's box in SVG coordinates. */
    x: number;
    y: number;
    /** Set only for nodes that were not on screen before: where they unfold from and when they move. */
    enter?: NodeEnter;
    /** Whether a category is shown expanded (also true while searching). */
    isExpanded: boolean;
    /** Called on click, Enter or Space. The parent decides what the node does (open, toggle, reset). */
    onActivate: (node: HierarchyPointNode<TreeNode>) => void;
};

/**
 * Draws one node of the tree (root, category or resource): its box, label and focus ring.
 * Each node is a single tab stop that is activated by click, Enter or Space. It must be rendered
 * inside an AnimatePresence so it can fade out when it is removed.
 */
export function TreeNodeView({ node, x, y, enter, isExpanded, onActivate }: TreeNodeViewProps) {
    const item = node.data;
    const isRoot = item.kind === "root";
    const isCategory = item.kind === "category";
    const isResource = item.kind === "resource";
    const width = NODE_WIDTHS[item.kind];

    const reduceMotion = useReducedMotion();
    // False while the node plays its exit animation: it is then a ghost that must not be focusable or clickable
    const isPresent = useIsPresent();

    // The nodes are flat siblings in the DOM, so screen readers get the tree structure from these attributes
    const siblings = node.parent?.children ?? [node];
    const treeItemProps = {
        "aria-level": node.depth + 1,
        "aria-setsize": siblings.length,
        "aria-posinset": siblings.indexOf(node) + 1,
        "aria-hidden": isPresent ? undefined : true,
        tabIndex: isPresent ? 0 : -1,
        // Lets the parent find this node's element (e.g. to return focus to it)
        "data-node-id": item.id,
    };

    // Category badge: "matched/total" while filtering (e.g. "2/4"), otherwise just the total
    const countLabel = isCategory
        ? item.matchedCount !== undefined
            ? `${item.matchedCount}/${item.count}`
            : `${item.count}`
        : "";

    // The same information in words, for the accessible name and the tooltip
    const countSummary = isCategory
        ? item.matchedCount !== undefined
            ? `${item.matchedCount} of ${item.count} resources match`
            : `${item.count} ${item.count === 1 ? "resource" : "resources"}`
        : "";

    // Tooltip for root/category nodes. Names are clipped, so categories repeat theirs in full.
    const tooltip = isCategory
        ? [item.name, item.description, `${countSummary}.`].filter(Boolean).join("\n")
        : item.description || item.name;

    const activate = () => onActivate(node);

    // Keyboard accessibility: Enter or Space does the same as a click
    const handleKeyDown = (event: KeyboardEvent<SVGGElement>) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault(); // stop Space from scrolling the page
        activate();
    };

    // New nodes slide out of their parent while the link draws (same delay, duration and easing);
    // nodes that are already on screen glide to their new position
    const moveTransition = enter
        ? { delay: enter.delay, duration: enter.duration, ease: "easeOut" as const }
        : reduceMotion
            ? INSTANT
            : MOVE_TRANSITION;

    return (
        // Outer group animates the node's position: new nodes start at their parent (`enter.from`),
        // existing ones start where they are. It also fades the node out when it is removed.
        // The inner motion.g handles the fade/scale-in, and each node's own <g>
        // handles focus, clicks and keyboard input.
        <motion.g
            initial={{ x: enter?.from.x ?? x, y: enter?.from.y ?? y }}
            animate={{ x, y }}
            exit={{ opacity: 0, transition: { duration: reduceMotion ? 0 : EXIT_DURATION } }}
            transition={moveTransition}
            style={isPresent ? undefined : { pointerEvents: "none" }}
        >
            <motion.g
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{
                    duration: reduceMotion ? 0 : NODE_FADE_DURATION,
                    delay: enter?.delay ?? 0,
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
                        {...treeItemProps}
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
                            x={LABEL_PADDING}
                            y={NODE_BOX_CENTER_Y}
                            dominantBaseline="middle"
                            fontSize="12"
                            fill="var(--osint-resource-text, #334155)"
                            pointerEvents="none"
                            // Long names are clipped to the label area; the tooltip shows the full name
                            clipPath={`url(#${labelClipId(item.kind)})`}
                        >
                            {item.name}
                        </text>
                        {/* Native tooltip with full name and URL */}
                        <title>{`${item.name}\n${item.url}`}</title>
                    </g>
                ) : (
                    // Root / category node: clickable and keyboard-accessible
                    <g
                        role="treeitem"
                        {...treeItemProps}
                        aria-expanded={isRoot ? true : isCategory ? isExpanded : undefined}
                        aria-label={
                            isCategory
                                ? `${item.name}, ${countSummary}`
                                : isRoot
                                    ? `${item.name}, resets the tree`
                                    : item.name
                        }
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
                            x={LABEL_PADDING}
                            y={NODE_BOX_CENTER_Y}
                            dominantBaseline="middle"
                            fontSize="12"
                            fontWeight={isRoot ? 700 : 600}
                            fill={isRoot
                                ? "var(--osint-root-text, #ffffff)"
                                : "var(--osint-category-text, #0f172a)"}
                            // Long names are clipped to the label area (categories keep the count badge clear)
                            clipPath={`url(#${labelClipId(item.kind)})`}
                        >
                            {/* Expand/collapse arrow (categories with resources only), then the name */}
                            {isCategory && item.count ? `${isExpanded ? "▾" : "▸"} ` : ""}
                            {item.name}
                        </text>
                        {/* Count badge, right-aligned inside category boxes */}
                        {isCategory && (
                            <text
                                x={width - LABEL_PADDING}
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
                        {/* Native tooltip: full name, description and how many resources match */}
                        <title>{tooltip}</title>
                    </g>
                )}
            </motion.g>
        </motion.g>
    );
}
