/* -------------------------------------------------------------------------- */
/*                         Layout and animation constants                     */
/* -------------------------------------------------------------------------- */

// Tree layout (in px)
export const NODE_HEIGHT = 42;        // vertical spacing between sibling nodes
export const HORIZONTAL_GAP = 250;    // horizontal spacing between depth levels
export const MARGIN = { top: 28, right: 32, bottom: 28, left: 24 };

/**
 * Width of a node's box (in px) by node kind. This is the single source of truth:
 * it drives how boxes are drawn, where links attach to their source node, and how
 * wide the SVG has to be.
 */
export const NODE_WIDTHS = { root: 158, category: 190, resource: 210 } as const;

/** Geometry shared by every node box, drawn relative to the node's position. */
export const NODE_BOX = { top: -16, height: 34, radius: 7 } as const;
/** Vertical middle of a node box, where its label sits. */
export const NODE_BOX_CENTER_Y = NODE_BOX.top + NODE_BOX.height / 2;

// Animation timing (in seconds)
export const LINK_DURATION = 0.45;         // how long a link takes to draw during the initial "grow from root" intro
export const LINK_DURATION_UPDATE = 0.25;  // shorter link duration for later updates (expand, collapse, search)
export const BRANCH_GAP = 0.02;            // small pause between a parent appearing and its links starting
export const SIBLING_STAGGER = 0.03;       // extra delay per new sibling, so long lists cascade in
export const MAX_STAGGER_ITEMS = 10;       // caps the cascade so large categories don't take too long (max 0.3s)

// Shared by nodes and their links when the layout shifts. Using the same duration and
// easing for both keeps each link attached to its nodes throughout the move.
export const MOVE_TRANSITION = { duration: 0.3, ease: "easeInOut" } as const;
