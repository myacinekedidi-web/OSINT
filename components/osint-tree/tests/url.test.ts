import { describe, expect, it } from "vitest";
import { isSafeUrl } from "../url";

describe("isSafeUrl", () => {
    it.each([
        "https://example.com",
        "https://example.com/path?query=1#hash",
        "HTTPS://EXAMPLE.COM",
    ])("accepts %s", (url: string) => {
        expect(isSafeUrl(url)).toBe(true);
    });

    it.each([
        "http://example.com",
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "ftp://example.com",
        "example.com",
        "not a url",
        "",
    ])("rejects %s", (url: string) => {
        expect(isSafeUrl(url)).toBe(false);
    });

    it("rejects a missing url", () => {
        expect(isSafeUrl(undefined)).toBe(false);
    });
});
