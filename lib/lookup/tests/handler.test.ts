import { describe, expect, it, vi } from "vitest";
import { ErrorResponseSchema, LookupResponseSchema, MAX_BODY_BYTES } from "../api";
import { handleLookup, type HandlerDeps } from "../handler";
import type { Provider } from "../provider";
import { PROVIDERS } from "../registry";

const NOW = () => new Date("2026-11-01T12:00:00.000Z");

const fakeProvider: Provider = {
    id: "internetdb",
    supports: (input) => input.kind === "ipv4",
    unsupportedNote: (input) => (input.kind === "ipv6" ? "IPv4 only." : undefined),
    lookup: async () => ({
        status: "ok",
        findings: [{ id: "internetdb:ports", title: "Open ports (1)", severity: "info", category: "exposure" }],
    }),
};

function makeDeps(overrides: Partial<HandlerDeps> = {}) {
    const logs: Record<string, unknown>[] = [];
    const deps: HandlerDeps = { providers: [fakeProvider], now: NOW, log: (entry) => logs.push(entry), ...overrides };
    return { deps, logs };
}

function post(body: unknown, headers: Record<string, string> = {}) {
    return new Request("https://app.test/api/lookup", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
    });
}

describe("a successful lookup", () => {
    it("returns the report in the documented envelope", async () => {
        const { deps } = makeDeps();
        const response = await handleLookup(post({ input: "8.8.8.8" }), deps);

        expect(response.status).toBe(200);
        const body = LookupResponseSchema.parse(await response.json());
        expect(body.report.input).toEqual({ kind: "ipv4", value: "8.8.8.8" });
        expect(body.report.sources[0]).toMatchObject({ source: "internetdb", status: "ok" });
        expect(body.notice).toBeUndefined();
    });

    it("is never cacheable and not sniffable", async () => {
        const response = await handleLookup(post({ input: "8.8.8.8" }), makeDeps().deps);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(response.headers.get("content-type")).toContain("application/json");
    });

    it("works with the normalized value, not the raw text", async () => {
        const response = await handleLookup(post({ input: "  8.8.8.8 \n" }), makeDeps().deps);
        const body = LookupResponseSchema.parse(await response.json());
        expect(body.report.input.value).toBe("8.8.8.8");
    });

    it("passes along the router's notice", async () => {
        const response = await handleLookup(post({ input: "example.com/login" }), makeDeps().deps);
        const body = LookupResponseSchema.parse(await response.json());
        expect(body.report.input.kind).toBe("url");
        expect(body.notice).toContain("https");
    });

    it("answers 200 with no sources when nothing applies yet", async () => {
        const response = await handleLookup(post({ input: "example.com" }), makeDeps().deps);
        expect(response.status).toBe(200);
        expect(LookupResponseSchema.parse(await response.json()).report.sources).toEqual([]);
    });

    it("explains an unsupported input type", async () => {
        const response = await handleLookup(post({ input: "2606:4700:4700::1111" }), makeDeps().deps);
        const body = LookupResponseSchema.parse(await response.json());
        expect(body.report.sources[0]).toMatchObject({ status: "unsupported", note: "IPv4 only." });
    });

    it("accepts a content type with parameters, in any case", async () => {
        const response = await handleLookup(post({ input: "8.8.8.8" }, { "content-type": "Application/JSON; charset=utf-8" }), makeDeps().deps);
        expect(response.status).toBe(200);
    });

    it("runs end to end through the real provider list", async () => {
        const fakeFetch = vi.fn(async () =>
            Response.json({ ip: "8.8.8.8", ports: [443, 53], cpes: [], hostnames: ["dns.google"], tags: [], vulns: [] }),
        ) as unknown as typeof fetch;

        const { deps } = makeDeps({ providers: PROVIDERS, fetch: fakeFetch });
        const response = await handleLookup(post({ input: "8.8.8.8" }), deps);
        const body = LookupResponseSchema.parse(await response.json());

        expect(body.report.sources[0]).toMatchObject({ source: "internetdb", status: "ok" });
        expect(body.report.sources[0].findings.map((f) => f.id)).toEqual(["internetdb:ports", "internetdb:hostnames"]);
        expect((fakeFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("https://internetdb.shodan.io/8.8.8.8");
    });
});

describe("rejected inputs (422)", () => {
    it.each([
        ["10.0.0.1", "non_public_ip"],
        ["localhost", "reserved_domain"],
        ["https://user:pw@example.com", "url_credentials"],
        ["ftp://example.com", "unsupported_url_scheme"],
        ["", "empty"],
        ["hello", "unrecognized"],
    ])("%j -> %s", async (input, code) => {
        const response = await handleLookup(post({ input }), makeDeps().deps);
        expect(response.status).toBe(422);
        const body = ErrorResponseSchema.parse(await response.json());
        expect(body.error.code).toBe(code);
        expect(body.error.message.length).toBeGreaterThan(5);
    });

    it("never calls a provider for a rejected input", async () => {
        const lookup = vi.fn(fakeProvider.lookup);
        await handleLookup(post({ input: "169.254.169.254" }), makeDeps({ providers: [{ ...fakeProvider, lookup }] }).deps);
        expect(lookup).not.toHaveBeenCalled();
    });
});

describe("malformed requests", () => {
    it.each([
        ["not JSON", "{nope", "invalid_json"],
        ["an empty body", "", "invalid_json"],
        ["a missing input", {}, "invalid_body"],
        ["a numeric input", { input: 8 }, "invalid_body"],
        ["a null input", { input: null }, "invalid_body"],
        ["an array", ["8.8.8.8"], "invalid_body"],
        ["an extra key", { input: "8.8.8.8", extra: 1 }, "invalid_body"],
    ])("rejects %s with 400 %s", async (_name, body, code) => {
        const response = await handleLookup(post(body as string), makeDeps().deps);
        expect(response.status).toBe(400);
        expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe(code);
    });

    it.each([
        ["text/plain", "text/plain"],
        ["a form post", "application/x-www-form-urlencoded"],
    ])("rejects %s with 415", async (_name, contentType) => {
        const response = await handleLookup(post('{"input":"8.8.8.8"}', { "content-type": contentType }), makeDeps().deps);
        expect(response.status).toBe(415);
        expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe("unsupported_media_type");
    });

    it("rejects a request with no content type", async () => {
        const request = new Request("https://app.test/api/lookup", { method: "POST", body: '{"input":"8.8.8.8"}', headers: {} });
        request.headers.delete("content-type");
        expect((await handleLookup(request, makeDeps().deps)).status).toBe(415);
    });

    it("rejects an oversized body (413), declared or streamed", async () => {
        const big = JSON.stringify({ input: "a".repeat(MAX_BODY_BYTES + 10) });

        const declared = await handleLookup(post(big, { "content-length": String(big.length) }), makeDeps().deps);
        expect(declared.status).toBe(413);

        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(big));
                controller.close();
            },
        });
        const streamed = new Request("https://app.test/api/lookup", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: stream,
            // @ts-expect-error: required by Node for streaming request bodies
            duplex: "half",
        });
        expect((await handleLookup(streamed, makeDeps().deps)).status).toBe(413);
    });

    it("accepts a body right at the limit", async () => {
        const padding = " ".repeat(MAX_BODY_BYTES - JSON.stringify({ input: "8.8.8.8" }).length);
        const response = await handleLookup(post(`{"input":"8.8.8.8"}${padding}`), makeDeps().deps);
        expect(response.status).toBe(200);
    });
});

describe("cross-site protection", () => {
    it("refuses requests the browser marks as cross-site", async () => {
        const lookup = vi.fn(fakeProvider.lookup);
        const response = await handleLookup(
            post({ input: "8.8.8.8" }, { "sec-fetch-site": "cross-site" }),
            makeDeps({ providers: [{ ...fakeProvider, lookup }] }).deps,
        );
        expect(response.status).toBe(403);
        expect(ErrorResponseSchema.parse(await response.json()).error.code).toBe("forbidden_origin");
        expect(lookup).not.toHaveBeenCalled();
    });

    it.each(["same-origin", "same-site", "none"])("allows sec-fetch-site: %s", async (value) => {
        const response = await handleLookup(post({ input: "8.8.8.8" }, { "sec-fetch-site": value }), makeDeps().deps);
        expect(response.status).toBe(200);
    });

    it("allows clients that send no such header (curl, server-side)", async () => {
        expect((await handleLookup(post({ input: "8.8.8.8" }), makeDeps().deps)).status).toBe(200);
    });
});

describe("privacy and failure", () => {
    it("logs the input type, timing and source statuses, never the input", async () => {
        const { deps, logs } = makeDeps();
        await handleLookup(post({ input: "alice@example.com" }), deps);

        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({ event: "lookup", kind: "email", sources: {} });
        expect(typeof logs[0].durationMs).toBe("number");
        expect(JSON.stringify(logs)).not.toContain("alice");
        expect(JSON.stringify(logs)).not.toContain("example.com");
    });

    it("logs source statuses by name", async () => {
        const { deps, logs } = makeDeps();
        await handleLookup(post({ input: "8.8.8.8" }), deps);
        expect(logs[0]).toMatchObject({ kind: "ipv4", sources: { internetdb: "ok" } });
        expect(JSON.stringify(logs)).not.toContain("8.8.8.8");
    });

    it("logs a rejection by reason only", async () => {
        const { deps, logs } = makeDeps();
        await handleLookup(post({ input: "10.1.2.3" }), deps);
        expect(logs[0]).toMatchObject({ event: "lookup_rejected", reason: "non_public_ip" });
        expect(JSON.stringify(logs)).not.toContain("10.1.2.3");
    });

    it("turns an unexpected exception into a generic 500 without leaking it", async () => {
        const { logs } = makeDeps();
        const exploding = {
            get providers(): never {
                throw new Error("boom: secret-token-abc for 8.8.8.8");
            },
            log: (entry: Record<string, unknown>) => logs.push(entry),
        } as unknown as HandlerDeps;

        const response = await handleLookup(post({ input: "8.8.8.8" }), exploding);
        expect(response.status).toBe(500);

        const body = await response.json();
        expect(ErrorResponseSchema.parse(body).error.code).toBe("internal");
        const text = JSON.stringify(body) + JSON.stringify(logs);
        expect(text).not.toContain("secret-token-abc");
        expect(text).not.toContain("8.8.8.8");
        expect(logs[0]).toMatchObject({ event: "lookup_error" });
    });

    it("errors carry the same no-store headers", async () => {
        const response = await handleLookup(post("{nope"), makeDeps().deps);
        expect(response.headers.get("cache-control")).toBe("no-store");
    });
});
