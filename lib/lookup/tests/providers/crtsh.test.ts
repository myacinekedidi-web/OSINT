import { describe, expect, it } from "vitest";
import { runProvider } from "../../provider";
import { SourceResultSchema } from "../../report";
import { CrtShSchema, crtsh, toFindings } from "../../providers/crtsh";
import { fakeNetwork, json, type Route } from "../fake-network";

const NOW = () => new Date("2026-11-01T12:00:00.000Z");

const row = (overrides: Record<string, unknown> = {}) => ({
    issuer_ca_id: 183267,
    issuer_name: "C=US, O=Let's Encrypt, CN=R11",
    common_name: "www.example.com",
    name_value: "example.com\nwww.example.com",
    id: 1,
    entry_timestamp: "2026-10-01T10:00:00.123",
    not_before: "2026-10-01T09:00:00",
    not_after: "2026-12-30T09:00:00",
    serial_number: "03abc",
    ...overrides,
});

const parse = (rows: unknown[]) => CrtShSchema.parse(rows);
const data = (finding: { data?: Record<string, unknown> } | undefined) => finding?.data ?? {};

describe("toFindings", () => {
    it("lists unique subdomains and ignores the apex itself", () => {
        const { findings } = toFindings(
            parse([
                row({ id: 1, name_value: "example.com\nwww.example.com", common_name: "www.example.com" }),
                row({ id: 2, name_value: "mail.example.com\nwww.example.com", common_name: "mail.example.com" }),
            ]),
            "example.com",
        );
        const subs = findings.find((f) => f.id === "crtsh:subdomains")!;
        expect(subs.title).toBe("Subdomains seen in certificates (2)");
        expect(data(subs)).toEqual({ subdomains: ["mail.example.com", "www.example.com"] });
    });

    it("strips wildcards and lowercases", () => {
        const { findings } = toFindings(parse([row({ name_value: "*.Example.com\nAPI.EXAMPLE.COM", common_name: "*.example.com" })]), "example.com");
        expect(data(findings.find((f) => f.id === "crtsh:subdomains"))).toEqual({ subdomains: ["api.example.com"] });
    });

    it("keeps only names under the domain: shared certificates list unrelated sites", () => {
        const { findings } = toFindings(
            parse([row({ name_value: "www.example.com\nother-site.org\nexample.com.evil.net\nnotexample.com\nsub.example.com", common_name: "other-site.org" })]),
            "example.com",
        );
        expect(data(findings.find((f) => f.id === "crtsh:subdomains"))).toEqual({
            subdomains: ["sub.example.com", "www.example.com"],
        });
    });

    it("summarizes the certificates: count, first and latest issue date, main issuers", () => {
        const { findings } = toFindings(
            parse([
                row({ id: 1, not_before: "2025-01-05T00:00:00", issuer_name: "C=US, O=Let's Encrypt, CN=R3" }),
                row({ id: 2, not_before: "2026-10-01T00:00:00", issuer_name: "C=US, O=Let's Encrypt, CN=R11" }),
                row({ id: 3, not_before: "2024-03-09T00:00:00", issuer_name: "C=US, O=DigiCert Inc, CN=DigiCert TLS RSA" }),
                row({ id: 3, not_before: "2024-03-09T00:00:00", issuer_name: "C=US, O=DigiCert Inc, CN=DigiCert TLS RSA" }), // same certificate listed twice
            ]),
            "example.com",
        );
        const certs = findings.find((f) => f.id === "crtsh:certificates")!;
        expect(certs.title).toBe("Certificates logged (3)");
        expect(data(certs)).toEqual({
            first_issued: ["2024-03-09"],
            latest_issued: ["2026-10-01"],
            main_issuers: ["Let's Encrypt", "DigiCert Inc"],
        });
    });

    it("falls back to the whole issuer string when it has no organization", () => {
        const { findings } = toFindings(parse([row({ issuer_name: "CN=Some Private CA" })]), "example.com");
        expect(data(findings.find((f) => f.id === "crtsh:certificates")).main_issuers).toEqual(["CN=Some Private CA"]);
    });

    it("shows at most 100 subdomains and says it cut the list", () => {
        const many = Array.from({ length: 150 }, (_, i) => `h${String(i).padStart(3, "0")}.example.com`).join("\n");
        const { findings, truncatedNames } = toFindings(parse([row({ name_value: many, common_name: null })]), "example.com");
        const subs = findings.find((f) => f.id === "crtsh:subdomains")!;
        expect(subs.title).toBe("Subdomains seen in certificates (150)");
        expect((data(subs).subdomains as string[]).length).toBe(100);
        expect(truncatedNames).toBe(true);
    });

    it("copes with missing fields", () => {
        const { findings } = toFindings(parse([{}, { id: 7 }, { name_value: null, common_name: null }]), "example.com");
        expect(findings.map((f) => f.id)).toEqual(["crtsh:certificates"]);
    });

    it("produces nothing for no rows", () => {
        expect(toFindings([], "example.com")).toEqual({ findings: [], truncatedNames: false });
    });
});

const URL_FOR = (domain: string) => `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json`;

const run = (routes: Route[], input: Parameters<typeof runProvider>[1] = { kind: "domain", value: "example.com" }) => {
    const network = fakeNetwork(routes);
    return runProvider(crtsh, input, { fetch: network.fetch, now: NOW }).then((source) => ({ source, network }));
};

describe("crtsh provider", () => {
    it("queries crt.sh for the domain's subdomains (with the % encoded) and reports them", async () => {
        const { source, network } = await run([[/crt\.sh/, json([row(), row({ id: 2, name_value: "mail.example.com", common_name: "mail.example.com" })])]]);

        expect(network.urls).toEqual(["https://crt.sh/?q=%25.example.com&output=json"]);
        expect(network.urls[0]).toBe(URL_FOR("example.com"));
        expect(source.status).toBe("ok");
        expect(source.findings.map((f) => f.id)).toEqual(["crtsh:subdomains", "crtsh:certificates"]);
        expect(source.freshness).toContain("Best effort");
        expect(source.note).toBeUndefined();
        expect(SourceResultSchema.safeParse(source).success).toBe(true);
    });

    it("applies to domains and URLs with a domain host, but not to emails or IPs", () => {
        expect(crtsh.supports({ kind: "domain", value: "example.com" })).toBe(true);
        expect(crtsh.supports({ kind: "url", value: "https://example.com/", hostname: "example.com" })).toBe(true);
        expect(crtsh.supports({ kind: "email", value: "a@example.com", domain: "example.com" })).toBe(false);
        expect(crtsh.supports({ kind: "ipv4", value: "8.8.8.8" })).toBe(false);
        expect(crtsh.supports({ kind: "url", value: "http://8.8.8.8/", hostname: "8.8.8.8" })).toBe(false);
        expect(crtsh.unsupportedNote?.({ kind: "ipv4", value: "8.8.8.8" })).toBeUndefined();
    });

    it("searches the whole registered domain for a subdomain, and says so", async () => {
        const { source, network } = await run([[/crt\.sh/, json([row()])]], { kind: "domain", value: "www.example.co.uk" });
        expect(network.urls[0]).toBe(URL_FOR("example.co.uk"));
        expect(source.note).toBe("Searched the whole registered domain example.co.uk.");
    });

    it("says which host of a URL it used", async () => {
        const { source } = await run([[/crt\.sh/, json([row()])]], { kind: "url", value: "https://example.com/x", hostname: "example.com" });
        expect(source.note).toContain("host of the URL");
    });

    it.each([
        ["an empty list", () => json([])],
        ["a 404", () => new Response("not found", { status: 404 })],
    ])("reports no-data for %s", async (_name, reply) => {
        const { source } = await run([[/crt\.sh/, reply]]);
        expect(source).toMatchObject({ status: "no-data", findings: [] });
        expect(source.note).toContain("No certificates found");
    });

    it("warns when crt.sh returns as many rows as it caps at", async () => {
        const rows = Array.from({ length: 1000 }, (_, i) => row({ id: i, name_value: `h${i}.example.com`, common_name: `h${i}.example.com` }));
        const { source } = await run([[/crt\.sh/, json(rows)]]);
        expect(source.status).toBe("ok");
        expect(source.note).toContain("may be incomplete");
    });

    it("warns when the subdomain list was cut", async () => {
        const rows = [row({ name_value: Array.from({ length: 120 }, (_, i) => `h${i}.example.com`).join("\n") })];
        const { source } = await run([[/crt\.sh/, json(rows)]]);
        expect(source.note).toContain("may be incomplete");
    });

    describe("an unreliable service", () => {
        it.each([
            ["an overloaded service", () => new Response("<html>502 Bad Gateway</html>", { status: 502 }), "error"],
            ["an HTML page with a 200", () => new Response("<html>busy</html>", { status: 200 }), "error"],
            ["a rate limit", () => new Response("slow", { status: 429 }), "rate-limited"],
            ["an unexpected shape", () => json({ not: "a list" }), "error"],
            ["a network failure", () => new TypeError("fetch failed"), "error"],
        ])("maps %s to %s", async (_name, reply, status) => {
            const { source } = await run([[/crt\.sh/, reply]]);
            expect(source.status).toBe(status);
            expect(source.findings).toEqual([]);
        });

        it("times out instead of hanging", async () => {
            const network = fakeNetwork([[/crt\.sh/, () => new Promise<Response>(() => {})]]);
            const source = await runProvider(crtsh, { kind: "domain", value: "example.com" }, { fetch: network.fetch, now: NOW, timeoutMs: 30 });
            expect(source.status).toBe("timeout");
        });

        it("refuses a response that is too large to handle", async () => {
            const big = JSON.stringify([row({ name_value: "x".repeat(6_000_000) })]);
            const { source } = await run([[/crt\.sh/, new Response(big, { status: 200 })]]);
            expect(source.status).toBe("error");
            expect(source.note).toContain("too large");
        });
    });
});
