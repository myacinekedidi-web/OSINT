import { vi } from "vitest";

type Reply = Response | Error | (() => Response | Error | Promise<Response | Error>);
export type Route = [match: RegExp | string, reply: Reply];

export type FakeNetwork = {
    fetch: typeof fetch;
    /** Every URL requested, in order. */
    urls: string[];
    /** Requests whose URL matched, with their init. */
    requests: { url: string; init: RequestInit }[];
    /** Hostnames contacted. */
    hosts: () => string[];
};

/**
 * A fetch that answers from a list of routes (first match wins) and records what was asked.
 * An unmatched request fails loudly, so a provider can never reach an address the test did not expect.
 */
export function fakeNetwork(routes: Route[]): FakeNetwork {
    const requests: FakeNetwork["requests"] = [];
    const impl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input);
        requests.push({ url, init });
        for (const [match, reply] of routes) {
            const hit = typeof match === "string" ? url === match || url.startsWith(match) : match.test(url);
            if (!hit) continue;
            // Like real fetch, give up when the request's signal aborts
            const signal = init.signal;
            const aborted = new Promise<never>((_resolve, reject) => {
                if (signal?.aborted) reject(signal.reason);
                signal?.addEventListener("abort", () => reject(signal.reason));
            });
            const value = await Promise.race([Promise.resolve(typeof reply === "function" ? reply() : reply), aborted]);
            if (value instanceof Error) throw value;
            // A Response body can only be read once, so hand out a fresh copy. (Not clone(): cancelling
            // one half of a tee waits for the other half, which real fetch responses never do.)
            const text = await value.clone().text();
            return new Response(text === "" ? null : text, { status: value.status, headers: value.headers });
        }
        throw new Error(`unexpected request: ${url}`);
    });
    return {
        fetch: impl as unknown as typeof fetch,
        get urls() {
            return requests.map((r) => r.url);
        },
        requests,
        hosts: () => [...new Set(requests.map((r) => new URL(r.url).hostname))],
    };
}

export const json = (body: unknown, status = 200) => Response.json(body, { status });

type Answer = { type: number; data: string; TTL?: number };

/** A DNS-over-HTTPS JSON response (Cloudflare / Google schema). */
export const doh = (answers: Answer[] = [], status = 0) =>
    Response.json({ Status: status, TC: false, RD: true, RA: true, AD: false, CD: false, Answer: answers.map((a) => ({ name: "x.", TTL: 300, ...a })) });

export const A = 1, NS = 2, CNAME = 5, MX = 15, TXT = 16, AAAA = 28;

/** Matches a DoH request for a given name and type (either resolver). */
export const dohRoute = (name: string, type: string): RegExp =>
    new RegExp(`(cloudflare-dns\\.com/dns-query|dns\\.google/resolve)\\?name=${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}&type=${type}$`);
