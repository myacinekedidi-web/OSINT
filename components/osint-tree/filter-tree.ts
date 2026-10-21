import type { TreeNode } from "./osint-types";

/**
 * Pure search/filter logic shared by the tree (and, later, the search dropdown).
 * No React and no hidden inputs: the same arguments always give the same result.
 */

/** When the query starts with this token, only favorited resources are shown. */
export const FAVORITES_TOKEN = "@favorites";

// The token only counts at the very start of the input and as a whole word
// (followed by whitespace or the end), so "@favoritesfoo" is plain text.
const FAVORITES_TOKEN_PATTERN = /^@favorites(?=\s|$)/i;

/** The raw search input, broken into the parts the filter cares about. */
export type ParsedQuery = {
    /** True when the query starts with the favorites token. */
    favoritesOnly: boolean;
    /** Lowercased search text with the favorites token removed ("" if none). */
    text: string;
    /** True when anything is being filtered: some text, or the favorites token. */
    hasQuery: boolean;
};

/** Application state the filter depends on besides the query itself. */
export type FilterContext = {
    /** Ids of favorited resources. */
    favorites: Set<string>;
    /** Category id -> whether the user expanded it (only used while there is no query). */
    expanded: Record<string, boolean>;
};

/**
 * Parses the raw input, e.g. "  @Favorites Shodan " -> { favoritesOnly: true, text: "shodan" }.
 * The token only counts at the very start of the input and as a whole word, so
 * "@favoritesfoo" is treated as plain text instead of the token followed by "foo".
 */
export function parseQuery(raw: string): ParsedQuery {
    const normalized = raw.trim().toLowerCase();
    const favoritesOnly = FAVORITES_TOKEN_PATTERN.test(normalized);
    const text = favoritesOnly
        ? normalized.slice(FAVORITES_TOKEN.length).trim()
        : normalized;

    return { favoritesOnly, text, hasQuery: normalized.length > 0 };
}

/**
 * Turns the favorites filter on or off in the raw input, keeping whatever else was typed
 * (and its original casing):
 *   ""               -> "@favorites "      (trailing space so the user can keep typing)
 *   "shodan"         -> "@favorites shodan"
 *   "@favorites"     -> ""
 *   "@favorites foo" -> "foo"
 */
export function toggleFavoritesToken(raw: string): string {
    const input = raw.trimStart();

    // Filter is on: remove the token, keep the rest
    if (FAVORITES_TOKEN_PATTERN.test(input)) {
        return input.slice(FAVORITES_TOKEN.length).trimStart();
    }

    // Filter is off: put the token in front of the existing text
    return `${FAVORITES_TOKEN} ${input}`;
}

/**
 * The single definition of "this resource matches the query": it passes the
 * favorites filter (when requested) and its searchable text contains the query text.
 * Meant for resource nodes.
 */
export function matchesResource(
    node: TreeNode,
    query: ParsedQuery,
    favorites: Set<string>
): boolean {
    if (query.favoritesOnly && !favorites.has(node.id)) return false;
    if (!query.text) return true;

    // Concatenate all searchable fields into one lowercase string
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

    return haystack.includes(query.text);
}

/**
 * Returns the subtree that should currently be displayed. Never modifies `root`.
 *  - The root is always kept, even when nothing matches (it then has no children).
 *  - With a query: only matching resources remain, categories auto-expand, and
 *    categories without matches are dropped.
 *  - Without a query: a category shows its resources only if the user expanded it.
 */
export function filterTree(
    root: TreeNode,
    query: ParsedQuery,
    { favorites, expanded }: FilterContext
): TreeNode {
    // Recursively filters a node. Returns null if the node should be hidden.
    const filterNode = (node: TreeNode): TreeNode | null => {
        // Leaf: keep it only if it matches
        if (node.kind === "resource") {
            return matchesResource(node, query, favorites)
                ? { ...node, children: undefined }
                : null;
        }

        // Branch: filter children first, dropping the ones that don't match
        const children = (node.children ?? [])
            .map(filterNode)
            .filter((child): child is TreeNode => child !== null);

        if (node.kind === "root") return { ...node, children };

        // While filtering, categories auto-expand but are hidden if nothing matches
        if (query.hasQuery) return children.length ? { ...node, children } : null;

        // Not filtering: only show a category's children if the user expanded it
        return { ...node, children: expanded[node.id] ? children : undefined };
    };

    return filterNode(root) ?? { ...root, children: [] };
}
