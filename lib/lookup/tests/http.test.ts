import { describe, expect, it, vi } from "vitest";
import { getJson, readTextLimited } from "../http";
import { ProviderError, type ProviderContext } from "../provider";

const makeCtx = (fetchImpl: typeof fetch): ProviderContext => ({
    signal: new AbortController().signal,
    fetch: fetchImpl,
    now: () => new Date("2026-11-01T12:00:00Z"),
});

const respond = (body: BodyInit | null, init: ResponseInit = {}) => vi.fn(async () => new Response(body, init));

const rejection = async (promise: Promise<unknown>) => {
    try {
        await promise;
    } catch (error) {
        return error as ProviderError;
    }
    throw new Error("expected the promise to reject");
};

describe("readTextLimited", () => {
    it("reads a small body", async () => {
        expect(await readTextLimited(new Response("hello"), 100)).toBe("hello");
    });

    it("returns an empty string when there is no body", async () => {
        expect(await readTextLimited(new Response(null, { status: 204 }), 100)).toBe("");
    });

    it("decodes multi-byte characters", async () => {
        expect(await readTextLimited(new Response("münchen ✓"), 100)).toBe("münchen ✓");
    });

    it("refuses a body whose declared length is too large", async () => {
        const response = new Response("x", { headers: { "content-length": "5000" } });
        const error = await rejection(readTextLimited(response, 100));
        expect(error).toBeInstanceOf(ProviderError);
        expect(error.status).toBe("error");
    });

    it("refuses a streamed body that grows past the limit", async () => {
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                const chunk = new TextEncoder().encode("x".repeat(60));
                controller.enqueue(chunk);
                controller.enqueue(chunk);
                controller.close();
            },
        });
        const error = await rejection(readTextLimited(new Response(stream), 100));
        expect(error.message).toContain("too large");
    });
});

describe("getJson", () => {
    it("returns the parsed body of a 200", async () => {
        const fetchImpl = respond(JSON.stringify({ a: 1 }), { status: 200 });
        expect(await getJson("https://example.test/x", makeCtx(fetchImpl))).toEqual({ status: 200, json: { a: 1 } });
    });

    it("asks for JSON, passes the abort signal and refuses redirects by default", async () => {
        const fetchImpl = respond("{}");
        const ctx = makeCtx(fetchImpl);
        await getJson("https://example.test/x", ctx);

        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("https://example.test/x");
        expect(init.redirect).toBe("error");
        expect(init.signal).toBe(ctx.signal);
        expect((init.headers as Record<string, string>).accept).toBe("application/json");
    });

    it("lets a provider opt in to redirects and extra headers", async () => {
        const fetchImpl = respond("{}");
        await getJson("https://example.test/x", makeCtx(fetchImpl), { redirect: "follow", headers: { "user-agent": "t" } });
        const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
        expect(init.redirect).toBe("follow");
        expect((init.headers as Record<string, string>)["user-agent"]).toBe("t");
    });

    it("returns a 404 to the caller, with or without a JSON body", async () => {
        const withJson = respond(JSON.stringify({ detail: "none" }), { status: 404 });
        expect(await getJson("https://example.test/x", makeCtx(withJson))).toEqual({ status: 404, json: { detail: "none" } });

        const withHtml = respond("<html>Not found</html>", { status: 404 });
        expect(await getJson("https://example.test/x", makeCtx(withHtml))).toEqual({ status: 404, json: null });
    });

    it("maps 429 to rate-limited and uses Retry-After when present", async () => {
        const fetchImpl = respond("slow down", { status: 429, headers: { "retry-after": "30" } });
        const error = await rejection(getJson("https://example.test/x", makeCtx(fetchImpl)));
        expect(error.status).toBe("rate-limited");
        expect(error.message).toContain("30 seconds");

        const plain = respond("slow down", { status: 429 });
        const error2 = await rejection(getJson("https://example.test/x", makeCtx(plain)));
        expect(error2.status).toBe("rate-limited");
    });

    it.each([400, 401, 403, 500, 502, 503])("maps HTTP %i to an error", async (status) => {
        const error = await rejection(getJson("https://example.test/x", makeCtx(respond("nope", { status }))));
        expect(error.status).toBe("error");
        expect(error.message).toContain(String(status));
    });

    it("maps a 200 with invalid JSON to an error", async () => {
        const error = await rejection(getJson("https://example.test/x", makeCtx(respond("<html>", { status: 200 }))));
        expect(error.status).toBe("error");
        expect(error.message).toContain("not valid JSON");
    });

    it("treats an empty 200 body as null", async () => {
        expect(await getJson("https://example.test/x", makeCtx(respond("", { status: 200 })))).toEqual({ status: 200, json: null });
    });

    it("enforces the size limit", async () => {
        const fetchImpl = respond("x".repeat(500));
        const error = await rejection(getJson("https://example.test/x", makeCtx(fetchImpl), { maxBytes: 100 }));
        expect(error.message).toContain("too large");
    });
});