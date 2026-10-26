/**
 * The text announced to screen readers (and shown when nothing matches) while a
 * search or the favorites filter is active. Pure, so it can be tested without React.
 */

export type SearchStatus = {
    /** "" when no search is active, so the live region stays silent. */
    message: string;
    /** True when the search matched nothing: the message is then shown to everyone. */
    isEmpty: boolean;
};

export type SearchStatusInput = {
    /** Anything is being filtered (some text, or the @favorites token). */
    hasQuery: boolean;
    /** Resources currently visible in the tree. */
    resourceCount: number;
    /** The @favorites token is present. */
    favoritesOnly: boolean;
    /** How many resources the user has favorited. */
    favoritesCount: number;
};

export function getSearchStatus({
    hasQuery,
    resourceCount,
    favoritesOnly,
    favoritesCount,
}: SearchStatusInput): SearchStatus {
    if (!hasQuery) return { message: "", isEmpty: false };

    if (resourceCount > 0) {
        const noun = resourceCount === 1 ? "resource" : "resources";
        return { message: `${resourceCount} ${noun} found.`, isEmpty: false };
    }

    return {
        message:
            favoritesOnly && favoritesCount === 0
                ? "No favorites yet. Open a resource and use Add to Favorites."
                : "No matching resources found.",
        isEmpty: true,
    };
}
