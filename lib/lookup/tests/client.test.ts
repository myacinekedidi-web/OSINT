import { describe, expect, it, vi } from "vitest";
import { LOOKUP_ENDPOINT, isLookupResponse, submitLookup } from "../client";
import { sampleReport } from "./fixtures";

const fakeFetch = (response: Response | Error) =>
    vi.fn(async () => {
        if (response instanceof Error) throw response;
        return response;
    }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

const jsonResponse = (body: unknown, status = 200) => Response.json(body, { status });

describe("submitLookup", () => {
    it("posts the input as JSON to the lookup endpoint", async () => {
        const doFetch = fakeFetch(jsonResponse({ report: sampleReport() }));
        const controller = new AbortController();
        await submitLookup("8.8.8.8", { fetch: doFetch, signal: controller.signal });

        const [url, init] = (doFetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
        expect(url).toBe(LOOKUP_ENDPOINT);
        expect(init.method).toBe("POST");
        expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
        expect(JSON.parse(init.body as string)).toEqual({ input: "8.8.8.8" });
        expect(init.signal).toBe(controller.signal);
    });

    it("returns the report and the notice on success", async () => {
        const report = sampleReport();
        const outcome = await submitLookup("x", { fetch: fakeFetch(jsonResponse({ report, notice: "assumed https://" })) });
        expect(outcome).toEqual({ ok: true, report, notice: "assumed https://" });
    });

    it("omits the notice when there is none", async () => {
        const outcome = await submitLookup("x", { fetch: fakeFetch(jsonResponse({ report: sampleReport() })) });
        expect(outcome).toEqual({ ok: true, report: sampleReport() });
    });

    it.each([
        [422, "non_public_ip", "That address is private."],
        [400, "invalid_body", "Expected a JSON object."],
        [403, "forbidden_origin", "Cross-site requests are not allowed."],
        [413, "payload_too_large", "The request is too large."],
        [415, "unsupported_media_type", "Send the request as application/json."],
    ])("shows the server's own message for HTTP %i", async (status, code, message) => {
        const outcome = await submitLookup("x", { fetch: fakeFetch(jsonResponse({ error: { code, message } }, status)) });
        expect(outcome).toEqual({ ok: false, kind: "rejected", message, code });
    });

    it("reports a server error with the server's message", async () => {
        const outcome = await submitLookup("x", {
            fetch: fakeFetch(jsonResponse({ error: { code: "internal", message: "Something went wrong." } }, 500)),
        });
        expect(outcome).toMatchObject({ ok: false, kind: "server", message: "Something went wrong." });
    });

    it("recognizes the platform's rate limit (a non-JSON 429)", async () => {
        const outcome = await submitLookup("x", { fetch: fakeFetch(new Response("Too Many Requests", { status: 429 })) });
        expect(outcome).toMatchObject({ ok: false, kind: "rate_limited" });
        expect(outcome.ok === false && outcome.message).toContain("Wait a minute");
    });

    it.each([
        ["an HTML 502 page", new Response("<html>Bad gateway</html>", { status: 502 }), "server"],
        ["an HTML 404 page", new Response("<html>Not found</html>", { status: 404 }), "invalid_response"],
        ["an empty 500", new Response(null, { status: 500 }), "server"],
        ["a 200 that is not JSON", new Response("<html>hi</html>", { status: 200 }), "invalid_response"],
        ["a 200 with the wrong shape", jsonResponse({ hello: "world" }), "invalid_response"],
        ["a 200 with a malformed report", jsonResponse({ report: { input: {}, sources: [] } }), "invalid_response"],
    ])("handles %s", async (_name, response, kind) => {
        const outcome = await submitLookup("x", { fetch: fakeFetch(response) });
        expect(outcome).toMatchObject({ ok: false, kind });
        expect(outcome.ok === false && outcome.message.length).toBeGreaterThan(10);
    });

    it("maps a dropped connection to a network error", async () => {
        const outcome = await submitLookup("x", { fetch: fakeFetch(new TypeError("Failed to fetch")) });
        expect(outcome).toMatchObject({ ok: false, kind: "network" });
    });

    it("maps a cancelled request to aborted", async () => {
        const outcome = await submitLookup("x", { fetch: fakeFetch(new DOMException("aborted", "AbortError")) });
        expect(outcome).toMatchObject({ ok: false, kind: "aborted" });
    });

    it("never throws, whatever happens", async () => {
        await expect(submitLookup("x", { fetch: fakeFetch(new Error("boom")) })).resolves.toMatchObject({ ok: false });
    });
});

describe("isLookupResponse", () => {
    it("accepts the server's real shape", () => {
        expect(isLookupResponse({ report: sampleReport() })).toBe(true);
        expect(isLookupResponse({ report: sampleReport(), notice: "n" })).toBe(true);
        expect(isLookupResponse({ report: sampleReport({ sources: [] }) })).toBe(true);
    });

    it.each([
        ["null", null],
        ["an array", []],
        ["no report", {}],
        ["a bad notice", { report: sampleReport(), notice: 5 }],
        ["no input", { report: { sources: [], generatedAt: "x" } }],
        ["sources not a list", { report: { input: { kind: "ipv4", value: "1.1.1.1" }, sources: {}, generatedAt: "x" } }],
        ["a source without status", { report: { input: { kind: "ipv4", value: "1.1.1.1" }, generatedAt: "x", sources: [{ source: "a", findings: [], fetchedAt: "x" }] } }],
        ["a finding without a title", { report: { input: { kind: "ipv4", value: "1.1.1.1" }, generatedAt: "x", sources: [{ source: "a", status: "ok", fetchedAt: "x", findings: [{ id: "1", severity: "info" }] }] } }],
    ])("rejects %s", (_name, value) => {
        expect(isLookupResponse(value)).toBe(false);
    });
});
