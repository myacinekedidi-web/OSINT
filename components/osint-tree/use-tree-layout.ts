import { useEffect, useMemo, useRef } from "react";
import { hierarchy, tree, type HierarchyPointNode } from "d3-hierarchy";
import type { TreeNode } from "./osint-types";
import {
    BRANCH_GAP,
    HORIZONTAL_GAP,
    LINK_DURATION,
    LINK_DURATION_UPDATE,
    MARGIN,
    MAX_STAGGER_ITEMS,
    NODE_HEIGHT,
    NODE_WIDTHS,
    SIBLING_STAGGER,
} from "./constants";

/**
 * Computes node positions and links with d3's tree layout, plus the reveal timing
 * for animations and the overall SVG dimensions. Recomputed whenever the visible
 * tree changes.
 */
export function useTreeLayout(visibleData: TreeNode) {
    // Ids of the nodes that were on screen after the last committed render.
    // Used to animate only newly added nodes; empty until the first render commits.
    const renderedIds = useRef<Set<string>>(new Set());

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
        // Right edge of the rightmost node box, so the last column is never clipped
        const rightEdge = nodes.reduce(
            (max, node) => Math.max(max, node.y + NODE_WIDTHS[node.data.kind]),
            0
        );

        const offsetX = MARGIN.left;
        const offsetY = MARGIN.top - minX;

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
            revealTimes,
            linkStarts,
            linkDuration,
            width: rightEdge + MARGIN.left + MARGIN.right,
            height: maxX - minX + MARGIN.top + MARGIN.bottom,
            offsetX,
            offsetY,
            pathFor,
        };
    }, [visibleData]);

    // After each committed render, remember which nodes are on screen so the
    // next layout only animates nodes that are actually new.
    useEffect(() => {
        renderedIds.current = new Set(layout.nodes.map((n) => n.data.id));
    }, [layout]);

    return layout;
}
