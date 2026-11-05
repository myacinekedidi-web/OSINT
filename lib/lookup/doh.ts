/**
 * DNS over HTTPS (JSON format) for the providers that need DNS answers.
 *
 * Cloudflare is tried first and Google's resolver, which speaks the same JSON schema, is
 * the backup. The JSON format has no RFC (Cloudflare says so itself), so every response is
 * validated, and anything unexpected counts as a failure of that resolver.
 */

import { z } from "zod";
import { getJson } from "./http";
import type { ProviderContext } from "./provider";

export const RR = { A: 1, NS: 2, CNAME: 5, MX: 15, TXT: 16, AAAA: 28 } as const;
export type RecordType = "A" | "AAAA" | "MX" | "NS" | "TXT";

export const RCODE = { NOERROR: 0, SERVFAIL: 2, NXDOMAIN: 3 } as const;

const DohResponseSchema = z.object({
    Status: z.number().int(),
    Answer: z
        .array(z.object({ type: z.number().int(), data: z.string(), TTL: z.number().optional() }))
        .default([]),
});

export type DnsAnswer = { type: number; data: string; ttl?: number };
export type DnsResult = { rcode: number; answers: DnsAnswer[] };

const RESOLVERS = [
    { name: "cloudflare", url: "https://cloudflare-dns.com/dns-query" },
    { name: "google", url: "https://dns.google/resolve" },
] as const;

async function askResolver(base: string, name: string, type: RecordType, ctx: ProviderContext): Promise<DnsResult> {
    const url = `${base}?name=${encodeURIComponent(name)}&type=${type}`;
    const { json } = await getJson(url, ctx, { headers: { accept: "application/dns-json" } });
    const parsed = DohResponseSchema.parse(json);
    return {
        rcode: parsed.Status,
        answers: parsed.Answer.map((a) => ({ type: a.type, data: a.data, ...(a.TTL !== undefined && { ttl: a.TTL }) })),
    };
}

/**
 * Asks for one record type. Falls back to the second resolver when the first fails for any
 * reason except the lookup's own deadline. NXDOMAIN and empty answers are results, not failures.
 */
export async function queryDns(name: string, type: RecordType, ctx: ProviderContext): Promise<DnsResult> {
    let lastError: unknown;
    for (const resolver of RESOLVERS) {
        try {
            return await askResolver(resolver.url, name, type, ctx);
        } catch (error) {
            if (ctx.signal.aborted) throw error; // out of time: do not start another request
            lastError = error;
        }
    }
    throw lastError;
}

/** Strips the trailing dot DNS adds to names ("mail.example.com." -> "mail.example.com"). */
export const stripDot = (name: string): string => name.replace(/\.$/, "");

/**
 * TXT answers arrive quoted, and long records as several quoted chunks: `"part one" "part two"`.
 * Returns the joined text.
 */
export function parseTxt(data: string): string {
    const chunks = [...data.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1].replace(/\\(["\\])/g, "$1"));
    return chunks.length > 0 ? chunks.join("") : data.trim();
}

/** "10 mail.example.com." -> { priority: 10, host: "mail.example.com" } */
export function parseMx(data: string): { priority: number; host: string } | null {
    const match = /^(\d+)\s+(\S+)$/.exec(data.trim());
    return match ? { priority: Number(match[1]), host: stripDot(match[2]).toLowerCase() } : null;
}
