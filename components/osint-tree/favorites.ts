import { useEffect, useState } from "react";
import { RESOURCE_ID_PREFIX } from "./build-tree";

// localStorage key for the favorites
export const FAVORITES_KEY = "osint-favorites";

// Reads favorites from localStorage. Falls back to an empty set if nothing is
// stored, the value is corrupted or has the wrong shape, or storage is unavailable.
export function loadFavorites(): Set<string> {
    try {
        const stored = localStorage.getItem(FAVORITES_KEY);
        if (!stored) return new Set();

        const parsed: unknown = JSON.parse(stored);
        if (!Array.isArray(parsed)) return new Set();

        // Keep only string ids, silently dropping anything malformed. Ids saved before
        // resource ids were prefixed get the prefix added, so old favorites keep working.
        return new Set(
            parsed
                .filter((id): id is string => typeof id === "string")
                .map((id) => (id.startsWith(RESOURCE_ID_PREFIX) ? id : `${RESOURCE_ID_PREFIX}${id}`))
        );
    } catch (error) {
        console.warn("Could not read favorites:", error);
        return new Set();
    }
}

// Writes favorites to localStorage; failures (quota, blocked storage) are non-fatal.
export function saveFavorites(favorites: Set<string>) {
    try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
    } catch (error) {
        console.warn("Could not save favorites:", error);
    }
}

/**
 * Manages the set of favorited resource ids and keeps it in sync with
 * localStorage (see FAVORITES_KEY).
 */
export function useFavorites() {
    const [favorites, setFavorites] = useState<Set<string>>(new Set());
    // Prevents the persist effect from overwriting stored data with the empty
    // initial set before the stored value has been read.
    const [favoritesLoaded, setFavoritesLoaded] = useState(false);

    // Load saved favorites once on mount (localStorage is only available in the browser)
    useEffect(() => {
        setFavorites(loadFavorites());
        setFavoritesLoaded(true);
    }, []);

    // Save favorites to localStorage whenever they change (after the initial load)
    useEffect(() => {
        if (!favoritesLoaded) return;
        saveFavorites(favorites);
    }, [favorites, favoritesLoaded]);

    // Adds the id if absent, removes it if present. Copies the Set so React sees a new reference.
    const toggleFavorite = (id: string) => {
        setFavorites((prev) => {
            const next = new Set(prev);

            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }

            return next;
        });
    };

    return { toggleFavorite, favorites };
}
