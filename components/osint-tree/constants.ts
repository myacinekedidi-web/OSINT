/* -------------------------------------------------------------------------- */
/*                         Layout and animation constants                     */
/* -------------------------------------------------------------------------- */

// Tree layout (in px)
export const NODE_HEIGHT = 42;        // vertical spacing between sibling nodes
export const HORIZONTAL_GAP = 250;    // horizontal spacing between depth levels
export const MARGIN = { top: 28, right: 32, bottom: 28, left: 24 };

/**
 * Vertical spacing between two neighbouring nodes that have different parents, as a multiple
 * of NODE_HEIGHT (siblings always use 1). It keeps branches visually grouped. d3's default is 2.
 */
export const GROUP_SEPARATION = 1.3;

/**
 * Width of a node's box (in px) by node kind. This is the single source of truth:
 * it drives how boxes are drawn, where links attach to their source node, and how
 * wide the SVG has to be.
 */
export const NODE_WIDTHS = { root: 158, category: 190, resource: 210 } as const;
export type NodeKind = keyof typeof NODE_WIDTHS;

/** Geometry shared by every node box, drawn relative to the node's position. */
export const NODE_BOX = { top: -16, height: 34, radius: 7 } as const;
/** Vertical middle of a node box, where its label sits. */
export const NODE_BOX_CENTER_Y = NODE_BOX.top + NODE_BOX.height / 2;

// Labels: the name is clipped to a per-kind label area instead of being cut at a character count
export const LABEL_PADDING = 10;            // space between the box edge and its label
export const CATEGORY_COUNT_RESERVE = 40;   // room kept free for the count badge ("12/30") in category boxes

/** Width (in px) of the area a node's name may occupy before it is clipped. */
export function labelWidth(kind: NodeKind): number {
    return NODE_WIDTHS[kind] - LABEL_PADDING * 2 - (kind === "category" ? CATEGORY_COUNT_RESERVE : 0);
}

// Animation timing (in seconds)
export const LINK_DURATION = 0.45;         // how long a link takes to draw during the initial "grow from root" intro
export const LINK_DURATION_UPDATE = 0.25;  // shorter link duration for later updates (expand, collapse, search)
export const BRANCH_GAP = 0.02;            // small pause between a parent appearing and its links starting
export const SIBLING_STAGGER = 0.03;       // extra delay per new sibling, so long lists cascade in
export const MAX_STAGGER_ITEMS = 10;       // caps the cascade so large categories don't take too long (max 0.3s)
export const NODE_FADE_DURATION = 0.2;     // how long a node takes to fade in
export const EXIT_DURATION = 0.15;         // how long nodes and links take to fade out when they are removed

// Shared by nodes and their links when the layout shifts. Using the same duration and
// easing for both keeps each link attached to its nodes throughout the move.
export const MOVE_TRANSITION = { duration: 0.3, ease: "easeInOut" } as const;

/** Transition used instead of any animation when the user prefers reduced motion. */
export const INSTANT = { duration: 0 } as const;
