/**
 * Shodan InternetDB: open ports, hostnames, software (CPEs), tags and known CVEs for an
 * IPv4 address.
 *
 * Source notes (checked 2026-11-01):
 *  - Free, no key. Free for NON-COMMERCIAL use only.
 *  - IPv4 only. Data is refreshed weekly, so it can be several days old.
 *  - No rate-limit number is published ("much higher" than the main API).
 *  - Unknown addresses answer 404 with a small JSON body.
 */

import { z } from "zod";
import { RCODE, RR, queryDns } from "../doh";
import { getJson } from "../http";
import { isIpv4, isPublicIpv4 } from "../ip";
import { ProviderError, type Provider, type ProviderContext, type ProviderOutcome } from "../provider";
import type { Finding } from "../report";
import { joinNotes, targetNote, targetOf } from "../target";

const BASE_URL = "https://internetdb.shodan.io/";

const FRESHNESS = "Shodan InternetDB is a weekly snapshot, so this data can be several days old.";

/** Unknown fields are ignored; missing lists count as empty. */
export const InternetDbSchema = z.object({
    ip: z.string(),
    ports: z.array(z.number().int().min(0).max(65535)).default([]),
    cpes: z.array(z.string()).default([]),
    hostnames: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    vulns: z.array(z.string()).default([]),
});
export type InternetDbRecord = z.infer<typeof InternetDbSchema>;

/** How many of a domain's addresses are checked. */
const MAX_ADDRESSES = 3;

/**
 * Turns a validated record into findings. Empty lists produce no finding. When the record
 * belongs to one of several addresses (a domain lookup), `address` is added to ids and titles.
 */
export function toFindings(record: InternetDbRecord, address?: string): Finding[] {
    const findings: Finding[] = [];
    const id = (name: string) => (address ? `internetdb:${address}:${name}` : `internetdb:${name}`);
    const title = (text: string) => (address ? `${text} on ${address}` : text);

    if (record.ports.length > 0) {
        findings.push({
            id: id("ports"),
            title: title(`Open ports (${record.ports.length})`),
            severity: "info",
            category: "exposure",
            detail: "Ports that Shodan saw accepting connections on this address.",
            data: { ports: [...record.ports].sort((a, b) => a - b) },
        });
    }

    if (record.vulns.length > 0) {
        findings.push({
            id: id("vulns"),
            title: title(`Known vulnerabilities (${record.vulns.length})`),
            // Presence only, not a CVSS score: InternetDB gives no severity per CVE
            severity: "medium",
            category: "vulnerability",
            detail:
                "CVEs Shodan associates with the software it detected. They are inferred from version banners and may not apply (for example, when fixes were backported).",
            data: { vulns: [...record.vulns].sort() },
        });
    }

    if (record.cpes.length > 0) {
        findings.push({
            id: id("cpes"),
            title: title(`Detected software (${record.cpes.length})`),
            severity: "info",
            category: "infrastructure",
            data: { cpes: record.cpes },
        });
    }

    if (record.hostnames.length > 0) {
        findings.push({
            id: id("hostnames"),
            title: title(`Hostnames (${record.hostnames.length})`),
            severity: "info",
            category: "infrastructure",
            data: { hostnames: record.hostnames },
        });
    }

    if (record.tags.length > 0) {
        findings.push({
            id: id("tags"),
            title: title("Tags"),
            severity: "info",
            category: "infrastructure",
            detail: "Labels Shodan attached to this address (for example cdn, cloud or vpn).",
            data: { tags: record.tags },
        });
    }

    return findings;
}

type AddressResult =
    | { address: string; outcome: "ok"; record: InternetDbRecord }
    | { address: string; outcome: "no-data" };

async function lookupAddress(address: string, ctx: ProviderContext): Promise<AddressResult> {
    const { status, json } = await getJson(`${BASE_URL}${encodeURIComponent(address)}`, ctx);
    if (status === 404) return { address, outcome: "no-data" };
    return { address, outcome: "ok", record: InternetDbSchema.parse(json) };
}

const noData = (note: string): ProviderOutcome => ({ status: "no-data", findings: [], freshness: FRESHNESS, note });

export const internetDb: Provider = {
    id: "internetdb",

    // IPv4 addresses, and domains / URLs, whose public IPv4 addresses are checked. Not emails.
    supports: (input) => input.kind !== "email" && targetOf(input).kind !== "ipv6",

    unsupportedNote: (input) =>
        input.kind !== "email" && targetOf(input).kind === "ipv6" ? "Shodan InternetDB covers IPv4 addresses only." : undefined,

    async lookup(input, ctx): Promise<ProviderOutcome> {
        const target = targetOf(input);
        if (target.kind === "ipv6" || input.kind === "email") throw new ProviderError("error", "Unsupported input type.");

        // A single address: the original, un-prefixed result
        if (target.kind === "ipv4") {
            const result = await lookupAddress(target.value, ctx);
            if (result.outcome === "no-data") {
                return noData(joinNotes(targetNote(input), "Shodan has no information about this address.")!);
            }
            const findings = toFindings(result.record);
            if (findings.length === 0) {
                return noData(joinNotes(targetNote(input), "Shodan knows this address but lists no open ports, software or vulnerabilities for it.")!);
            }
            return { status: "ok", findings, freshness: FRESHNESS, ...(targetNote(input) && { note: targetNote(input) }) };
        }

        // A domain: resolve it, then check the public IPv4 addresses it points to
        const dns = await queryDns(target.value, "A", ctx);
        if (dns.rcode === RCODE.NXDOMAIN) {
            return noData(joinNotes(targetNote(input), `${target.value} does not exist in DNS, so there are no addresses to check.`)!);
        }
        const resolved = [...new Set(dns.answers.filter((a) => a.type === RR.A && isIpv4(a.data)).map((a) => a.data))];
        const addresses = resolved.filter(isPublicIpv4).slice(0, MAX_ADDRESSES);
        if (addresses.length === 0) {
            return noData(joinNotes(targetNote(input), `${target.value} has no public IPv4 address to check.`)!);
        }

        const settled = await Promise.allSettled(addresses.map((address) => lookupAddress(address, ctx)));
        const results = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
        const failures = settled.flatMap((s) => (s.status === "rejected" ? [s.reason] : []));

        const findings = results.flatMap((r) => (r.outcome === "ok" ? toFindings(r.record, r.address) : []));
        const checked = `Checked the address${addresses.length === 1 ? "" : "es"} ${target.value} resolves to: ${addresses.join(", ")}.`;
        const partial = failures.length > 0 && results.length > 0 ? `${failures.length} of ${addresses.length} lookups failed.` : undefined;

        if (findings.length === 0) {
            // Nothing found. If every lookup failed, report that failure instead of "no data".
            if (results.length === 0) throw failures[0];
            return noData(joinNotes(targetNote(input), checked, "Shodan has no open ports, software or vulnerabilities on record for them.")!);
        }
        return { status: "ok", findings, freshness: FRESHNESS, note: joinNotes(targetNote(input), checked, partial) };
    },
};
