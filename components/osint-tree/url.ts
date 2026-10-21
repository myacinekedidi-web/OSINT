/**
 * True only for well-formed https URLs. Used to guard the "Go to Link" and
 * "Copy URL" actions (the scheme check is case-insensitive).
 */
export function isSafeUrl(url?: string): url is string {
    if (!url) return false;
    try {
        return new URL(url).protocol === "https:";
    } catch {
        return false;
    }
}
