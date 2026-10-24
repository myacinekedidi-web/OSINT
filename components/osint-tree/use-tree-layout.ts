import { useEffect, useMemo, useRef } from "react";
import type { TreeNode } from "./osint-types";
import { computeLayout } from "./compute-layout";

/**
 * React wrapper around `computeLayout`: recomputes the layout whenever the visible tree
 * changes and remembers which nodes are on screen, so the next layout only animates
 * nodes that are actually new. The layout math itself lives in compute-layout.ts.
 */
export function useTreeLayout(visibleData: TreeNode, reduceMotion = false) {
    // Ids of the nodes that were on screen after the last committed render.
    // Empty until the first render commits.
    const renderedIds = useRef<Set<string>>(new Set());

    const layout = useMemo(
        () => computeLayout(visibleData, renderedIds.current, reduceMotion),
        [visibleData, reduceMotion]
    );

    // After each committed render, remember which nodes are on screen
    useEffect(() => {
        renderedIds.current = new Set(layout.nodes.map((n) => n.data.id));
    }, [layout]);

    return layout;
}
