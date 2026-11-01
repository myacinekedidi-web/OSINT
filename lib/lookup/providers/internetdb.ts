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
import { getJson } from "../http";
import { ProviderError, type Provider, type ProviderOutcome } from "../provider";
import type { Finding } from "../report";

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

/** Turns a validated record into findings. Empty lists produce no finding. */
export function toFindings(record: InternetDbRecord): Finding[] {
    const findings: Finding[] = [];

    if (record.ports.length > 0) {
        findings.push({
            id: "internetdb:ports",
            title: `Open ports (${record.ports.length})`,
            severity: "info",
            category: "exposure",
            detail: "Ports that Shodan saw accepting connections on this address.",
            data: { ports: [...record.ports].sort((a, b) => a - b) },
        });
    }

    if (record.vulns.length > 0) {
        findings.push({
            id: "internetdb:vulns",
            title: `Known vulnerabilities (${record.vulns.length})`,
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
            id: "internetdb:cpes",
            title: `Detected software (${record.cpes.length})`,
            severity: "info",
            category: "infrastructure",
            data: { cpes: record.cpes },
        });
    }

    if (record.hostnames.length > 0) {
        findings.push({
            id: "internetdb:hostnames",
            title: `Hostnames (${record.hostnames.length})`,
            severity: "info",
            category: "infrastructure",
            data: { hostnames: record.hostnames },
        });
    }

    if (record.tags.length > 0) {
        findings.push({
            id: "internetdb:tags",
            title: "Tags",
            severity: "info",
            category: "infrastructure",
            detail: "Labels Shodan attached to this address (for example cdn, cloud or vpn).",
            data: { tags: record.tags },
        });
    }

    return findings;
}

export const internetDb: Provider = {
    id: "internetdb",

    supports: (input) => input.kind === "ipv4",

    unsupportedNote: (input) =>
        input.kind === "ipv6" ? "Shodan InternetDB covers IPv4 addresses only." : undefined,

    async lookup(input, ctx): Promise<ProviderOutcome> {
        if (input.kind !== "ipv4") throw new ProviderError("error", "Unsupported input type.");

        const { status, json } = await getJson(`${BASE_URL}${encodeURIComponent(input.value)}`, ctx);

        if (status === 404) {
            return { status: "no-data", findings: [], freshness: FRESHNESS, note: "Shodan has no information about this address." };
        }

        const findings = toFindings(InternetDbSchema.parse(json));
        if (findings.length === 0) {
            return {
                status: "no-data",
                findings: [],
                freshness: FRESHNESS,
                note: "Shodan knows this address but lists no open ports, software or vulnerabilities for it.",
            };
        }
        return { status: "ok", findings, freshness: FRESHNESS };
    },
};