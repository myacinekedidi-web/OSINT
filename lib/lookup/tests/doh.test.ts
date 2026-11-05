import { describe, expect, it } from "vitest";
import { RCODE, parseMx, parseTxt, queryDns, stripDot } from "../doh";
import type { ProviderContext } from "../provider";
import { A, MX, doh, fakeNetwork, json } from "./fake-network";

const ctxFor = (network: { fetch: typeof fetch }, signal = new AbortController().signal): ProviderContext => ({
    fetch: network.fetch,
    signal,
    now: () => new Date("2026-11-01T12:00:00Z"),
});

describe("parseTxt", () => {
    it.each([
        ['"v=spf1 include:_spf.google.com ~all"', "v=spf1 include:_spf.google.com ~all"],
        ['"part one, " "part two"', "part one, part two"], // long records arrive in chunks
        ['"say \\"hi\\" \\\\ there"', 'say "hi" \\ there'],
        ["unquoted value ", "unquoted value"],
        ['""', ""],
    ])("%s", (input, expected) => {
        expect(parseTxt(input)).toBe(expected);
    });
});

describe("parseMx / stripDot", () => {
    it("parses preference and host", () => {
        expect(parseMx("10 Mail.Example.com.")).toEqual({ priority: 10, host: "mail.example.com" });
        expect(parseMx("0 .")).toEqual({ priority: 0, host: "" }); // null MX
    });

    it.each(["", "mail.example.com", "x 10", "10"])("rejects %j", (input) => {
        expect(parseMx(input)).toBeNull();
    });

    it("strips one trailing dot", () => {
        expect(stripDot("example.com.")).toBe("example.com");
        expect(stripDot("example.com")).toBe("example.com");
    });
});

describe("queryDns", () => {
    it("asks Cloudflare for JSON with the right name and type", async () => {
        const network = fakeNetwork([[/cloudflare-dns\.com/, doh([{ type: A, data: "93.184.216.34" }])]]);
        const result = await queryDns("example.com", "A", ctxFor(network));

        expect(result).toEqual({ rcode: 0, answers: [{ type: A, data: "93.184.216.34", ttl: 300 }] });
        expect(network.urls).toEqual(["https://cloudflare-dns.com/dns-query?name=example.com&type=A"]);
        expect((network.requests[0].init.headers as Record<string, string>).accept).toBe("application/dns-json");
    });

    it("encodes the name", async () => {
        const network = fakeNetwork([[/cloudflare-dns\.com/, doh()]]);
        await queryDns("_dmarc.example.com", "TXT", ctxFor(network));
        expect(network.urls[0]).toContain("name=_dmarc.example.com&type=TXT");
    });

    it("returns NXDOMAIN and empty answers as results, not failures", async () => {
        const nx = await queryDns("nope.example", "A", ctxFor(fakeNetwork([[/cloudflare/, doh([], RCODE.NXDOMAIN)]])));
        expect(nx).toEqual({ rcode: RCODE.NXDOMAIN, answers: [] });

        const empty = await queryDns("example.com", "MX", ctxFor(fakeNetwork([[/cloudflare/, json({ Status: 0 })]])));
        expect(empty).toEqual({ rcode: 0, answers: [] });
    });

    it.each([
        ["an HTTP 500", () => new Response("oops", { status: 500 })],
        ["an HTTP 400", () => json({ error: "bad request" }, 400)],
        ["a rate limit", () => new Response("slow", { status: 429 })],
        ["a network error", () => new TypeError("fetch failed")],
        ["an unexpected body", () => json({ nope: true })],
        ["an HTML page", () => new Response("<html>", { status: 200 })],
    ])("falls back to Google after %s", async (_name, reply) => {
        const network = fakeNetwork([
            [/cloudflare/, reply],
            [/dns\.google/, doh([{ type: MX, data: "10 mail.example.com." }])],
        ]);
        const result = await queryDns("example.com", "MX", ctxFor(network));

        expect(result.answers[0].data).toBe("10 mail.example.com.");
        expect(network.hosts()).toEqual(["cloudflare-dns.com", "dns.google"]);
        expect(network.urls[1]).toBe("https://dns.google/resolve?name=example.com&type=MX");
    });

    it("gives up when both resolvers fail", async () => {
        const network = fakeNetwork([
            [/cloudflare/, new Response("x", { status: 500 })],
            [/dns\.google/, new Response("x", { status: 503 })],
        ]);
        await expect(queryDns("example.com", "A", ctxFor(network))).rejects.toThrow(/503/);
    });

    it("does not start a second request once the deadline has passed", async () => {
        const controller = new AbortController();
        const network = fakeNetwork([
            [
                /cloudflare/,
                () => {
                    controller.abort();
                    return new DOMException("aborted", "AbortError") as unknown as Error;
                },
            ],
            [/dns\.google/, doh()],
        ]);
        await expect(queryDns("example.com", "A", ctxFor(network, controller.signal))).rejects.toThrow();
        expect(network.hosts()).toEqual(["cloudflare-dns.com"]);
    });
});
