import { hierarchy, tree, type HierarchyPointNode } from "d3-hierarchy";
import type { TreeNode } from "./osint-types";
import {
    BRANCH_GAP,
    GROUP_SEPARATION,
    HORIZONTAL_GAP,
    LINK_DURATION,
    LINK_DURATION_UPDATE,
    MARGIN,
    MAX_STAGGER_ITEMS,
    NODE_HEIGHT,
    NODE_WIDTHS,
    SIBLING_STAGGER,
} from "./constants";

/** How a node that was not on screen before enters: where it starts and when/how long it moves. */
export type NodeEnter = {
    /** Position (SVG coordinates) the node starts from: its parent's right edge, so it unfolds from the parent. */
    from: { x: number; y: number };
    /** Seconds to wait before it starts moving and fading in (timed with its incoming link). */
    delay: number;
    /** Seconds the move takes (the same as the link drawing in). */
    duration: number;
};

/**
 * Pure layout computation for the visible tree: node positions and links (d3 tree layout),
 * animation timing for the nodes that are new, and the overall SVG size.
 *
 * @param renderedIds   ids of the nodes that were on screen after the last render. Those don't
 *                      re-animate, so only new nodes get an `enter` entry. Empty on the first render.
 * @param reduceMotion  when true nothing is delayed or animated: no stagger, no unfolding, zero durations.
 */
export function computeLayout(
    visibleData: TreeNode,
    renderedIds: ReadonlySet<string>,
    reduceMotion = false
) {
    const root = hierarchy<TreeNode>(visibleData, (node) => node.children);
    // nodeSize([a, b]): `a` is spacing along d3's x axis (our vertical),
    // `b` is spacing along d3's y axis (our horizontal), since the tree grows left to right.
    // separation: siblings sit 1 unit apart, nodes with different parents a bit further apart.
    const positionedRoot = tree<TreeNode>()
        .nodeSize([NODE_HEIGHT, HORIZONTAL_GAP])
        .separation((a, b) => (a.parent === b.parent ? 1 : GROUP_SEPARATION))(root);
    const nodes = positionedRoot.descendants();
    const links = positionedRoot.links();

    // Bounds of the layout. d3 centers the root at x = 0, so x can be negative;
    // that's why offsetY shifts everything down by -minX.
    const minX = Math.min(0, ...nodes.map((node) => node.x));
    const maxX = Math.max(0, ...nodes.map((node) => node.x));
    // Right edge of the rightmost node box, so the last column is never clipped
    const rightEdge = nodes.reduce(
        (max, node) => Math.max(max, node.y + NODE_WIDTHS[node.data.kind]),
        0
    );

    const offsetX = MARGIN.left;
    const offsetY = MARGIN.top - minX;

    // Position of a node's box in SVG coordinates (d3's y is our horizontal axis and x our vertical)
    const positionOf = (node: HierarchyPointNode<TreeNode>) => ({
        x: node.y + offsetX,
        y: node.x + offsetY,
    });

    // Animation timing: a new node unfolds from its parent as the link into it draws, and its own
    // children start once it has arrived. Nodes already on screen don't re-animate, so they add no
    // delay and new nodes are timed from their nearest already-visible ancestor.
    // Nothing is on screen before the first render, so the intro still grows from the root.
    const isInitialRender = renderedIds.size === 0;
    const linkDuration = reduceMotion ? 0 : isInitialRender ? LINK_DURATION : LINK_DURATION_UPDATE;

    const arrivalTimes = new Map<string, number>(); // when each node has arrived (its children start after this)
    const linkStarts = new Map<string, number>();   // when the link into each node starts drawing
    const enter = new Map<string, NodeEnter>();     // only for nodes that are new
    arrivalTimes.set(positionedRoot.data.id, 0);

    // eachBefore visits parents before children, so a parent's time is always set first
    positionedRoot.eachBefore((node) => {
        const parentArrival = arrivalTimes.get(node.data.id) ?? 0;
        const parentPosition = positionOf(node);
        let newSiblingIndex = 0; // position among the *new* children only

        for (const child of node.children ?? []) {
            if (renderedIds.has(child.data.id)) {
                // Already on screen: no animation, no delay
                arrivalTimes.set(child.data.id, 0);
                linkStarts.set(child.data.id, 0);
                continue;
            }

            // Small per-sibling stagger (capped) so long lists cascade in
            const stagger = reduceMotion ? 0 : Math.min(newSiblingIndex, MAX_STAGGER_ITEMS) * SIBLING_STAGGER;
            newSiblingIndex++;

            const linkStart = reduceMotion ? 0 : parentArrival + BRANCH_GAP + stagger;
            linkStarts.set(child.data.id, linkStart);
            arrivalTimes.set(child.data.id, linkStart + linkDuration);

            enter.set(child.data.id, {
                // Start at the parent's right edge (the child's left edge meets it) and slide out
                from: reduceMotion
                    ? positionOf(child)
                    : { x: parentPosition.x + NODE_WIDTHS[node.data.kind], y: parentPosition.y },
                delay: linkStart,
                duration: linkDuration,
            });
        }
    });

    // Builds the SVG path (a smooth cubic Bézier) connecting a parent node's
    // right edge to a child node's left edge.
    const pathFor = (
        source: HierarchyPointNode<TreeNode>,
        target: HierarchyPointNode<TreeNode>
    ) => {
        const sx = source.y + offsetX + NODE_WIDTHS[source.data.kind];
        const sy = source.x + offsetY;
        const tx = target.y + offsetX;
        const ty = target.x + offsetY;
        // Control points share the horizontal midpoint, giving an S-shaped curve
        const middle = (sx + tx) / 2;
        return `M ${sx} ${sy} C ${middle} ${sy}, ${middle} ${ty}, ${tx} ${ty}`;
    };

    return {
        nodes,
        links,
        enter,
        linkStarts,
        linkDuration,
        width: rightEdge + MARGIN.left + MARGIN.right,
        height: maxX - minX + MARGIN.top + MARGIN.bottom,
        offsetX,
        offsetY,
        pathFor,
    };
}

export type TreeLayout = ReturnType<typeof computeLayout>;
