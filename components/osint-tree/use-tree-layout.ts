import { useState } from "react";
import type { TreeNode } from "./osint-types";
import { computeLayout } from "./compute-layout";

type Layout = ReturnType<typeof computeLayout>;
type LayoutState = { visibleData: TreeNode; reduceMotion: boolean; layout: Layout };

const NOTHING_ON_SCREEN: ReadonlySet<string> = new Set();

/**
 * React wrapper around `computeLayout`: recomputes the layout whenever the visible tree
 * changes and uses the previous layout to know which nodes are already on screen, so only
 * new nodes animate. The layout math itself lives in compute-layout.ts.
 */
export function useTreeLayout(visibleData: TreeNode, reduceMotion = false): Layout {
    const [state, setState] = useState<LayoutState>(() => ({
        visibleData,
        reduceMotion,
        // Nothing is on screen yet, so the first layout plays the intro from the root
        layout: computeLayout(visibleData, NOTHING_ON_SCREEN, reduceMotion),
    }));

    if (state.visibleData === visibleData && state.reduceMotion === reduceMotion) {
        return state.layout;
    }

    // Inputs changed: the previous layout's nodes are the ones currently on screen
    const onScreen = new Set(state.layout.nodes.map((node) => node.data.id));
    const next: LayoutState = {
        visibleData,
        reduceMotion,
        layout: computeLayout(visibleData, onScreen, reduceMotion),
    };
    setState(next); // allowed during render: React re-renders immediately with the new state
    return next.layout;
}