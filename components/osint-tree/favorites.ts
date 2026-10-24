import { RESOURCE_ID_PREFIX } from "./build-tree";
import { useSyncExternalStore } from "react";

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

// --- External store backing useFavorites -----------------------------------
// The snapshot must keep the same reference until the data actually changes,
// otherwise useSyncExternalStore re-renders forever. So it's cached here.
const EMPTY_FAVORITES: Set<string> = new Set(); // what the server (and hydration) sees
let cache: Set<string> | null = null;
const listeners = new Set<() => void>();

function emit() {
    listeners.forEach((listener) => listener());
}

function getSnapshot(): Set<string> {
    return (cache ??= loadFavorites());
}

function getServerSnapshot(): Set<string> {
    return EMPTY_FAVORITES;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);

    // Another tab changed favorites: reload and notify
    const onStorage = (event: StorageEvent) => {
        if (event.key !== null && event.key !== FAVORITES_KEY) return;
        cache = loadFavorites();
        emit();
    };
    window.addEventListener("storage", onStorage);

    return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
    };
}

// Adds the id if absent, removes it if present. Always builds a new Set so the snapshot reference changes.
function toggleFavorite(id: string) {
    const next = new Set(getSnapshot());
    if (next.has(id)) {
        next.delete(id);
    } else {
        next.add(id);
    }
    cache = next;
    saveFavorites(next);
    emit();
}

/**
 * The set of favorited resource ids, kept in sync with localStorage (see FAVORITES_KEY)
 * and across tabs.
 */
export function useFavorites() {
    const favorites = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    return { toggleFavorite, favorites };
}