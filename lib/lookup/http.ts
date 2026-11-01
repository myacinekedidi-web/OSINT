/**
 * HTTP helpers for providers: one place that enforces the politeness rules (timeouts come
 * from the context's signal, response size is capped, redirects are off unless a provider
 * asks for them) and turns HTTP failures into ProviderErrors.
 */

import { ProviderError, type ProviderContext } from "./provider";

export const DEFAULT_MAX_BYTES = 1_000_000;

/** Thrown when a body is larger than the limit that was asked for. */
export class BodyTooLargeError extends Error {
    constructor() {
        super("Body too large");
        this.name = "BodyTooLargeError";
    }
}

/** Anything with a body and headers: a fetch `Response` or an incoming `Request`. */
type BodySource = { body: ReadableStream<Uint8Array> | null; headers: Headers };

/**
 * Reads a body as text, throwing BodyTooLargeError as soon as it is known to exceed
 * `maxBytes` (from `content-length` when declared, otherwise while streaming).
 */
export async function readBodyLimited(source: BodySource, maxBytes: number): Promise<string> {
    const declared = Number(source.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
        await source.body?.cancel();
        throw new BodyTooLargeError();
    }
    if (!source.body) return "";

    const reader = source.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
            await reader.cancel();
            throw new BodyTooLargeError();
        }
        chunks.push(value);
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}

/** Provider-side wrapper: a too-large upstream response becomes a ProviderError. */
export async function readTextLimited(response: Response, maxBytes: number): Promise<string> {
    try {
        return await readBodyLimited(response, maxBytes);
    } catch (error) {
        if (error instanceof BodyTooLargeError) {
            throw new ProviderError("error", "The data source's response was too large.");
        }
        throw error;
    }
}

export type GetJsonOptions = {
    maxBytes?: number;
    /** Default "error": a redirect fails the request instead of following it to another host. */
    redirect?: RequestRedirect;
    headers?: Record<string, string>;
};

/**
 * GET a URL and parse the JSON body. Returns for 2xx and 404 (the provider decides what
 * "not found" means). 429 becomes `rate-limited`; every other failure becomes `error`.
 */
export async function getJson(
    url: string,
    ctx: ProviderContext,
    options: GetJsonOptions = {},
): Promise<{ status: number; json: unknown }> {
    const response = await ctx.fetch(url, {
        method: "GET",
        signal: ctx.signal,
        redirect: options.redirect ?? "error",
        headers: { accept: "application/json", ...options.headers },
    });

    if (response.status === 429) {
        await response.body?.cancel();
        const seconds = Number(response.headers.get("retry-after"));
        throw new ProviderError(
            "rate-limited",
            Number.isFinite(seconds) && seconds > 0
                ? `The data source is rate-limiting requests. Try again in about ${Math.ceil(seconds)} seconds.`
                : "The data source is rate-limiting requests. Try again shortly.",
        );
    }
    if (response.status !== 404 && !response.ok) {
        await response.body?.cancel();
        throw new ProviderError("error", `The data source returned an error (HTTP ${response.status}).`);
    }

    const text = await readTextLimited(response, options.maxBytes ?? DEFAULT_MAX_BYTES);
    if (text === "") return { status: response.status, json: null };
    try {
        return { status: response.status, json: JSON.parse(text) };
    } catch {
        if (response.status === 404) return { status: 404, json: null }; // an HTML or plain-text 404 page
        throw new ProviderError("error", "The data source returned a response that is not valid JSON.");
    }
}
