/**
 * Certificate Transparency via crt.sh: every public TLS certificate issued for a domain is
 * logged, so the logs reveal subdomains (staging, vpn, mail, ...) and when certificates were issued.
 *
 * crt.sh has no official API, SLA, terms or published rate limits (checked 2026-11-01). Its JSON
 * output is unofficial and the service is often slow or overloaded, so this provider is best
 * effort: a failure or timeout simply shows up as a status in the report. Results are reportedly
 * capped around 1,000 rows, so a full result set is flagged as possibly incomplete.
 *
 * Certificates often list unrelated names on shared certificates; only names that are the domain
 * itself or its subdomains are kept.
 */

import { z } from "zod";
import { getJson } from "../http";
import { ProviderError, type Provider, type ProviderOutcome } from "../provider";
import type { Finding } from "../report";
import { joinNotes, registrableDomain, targetNote, targetOf } from "../target";

const BASE_URL = "https://crt.sh/";
const MAX_BYTES = 5_000_000;
const ROW_LIMIT_HINT = 1000;
const MAX_NAMES_SHOWN = 100;
const MAX_ISSUERS_SHOWN = 3;

const FRESHNESS = "Certificate Transparency logs via crt.sh. Best effort: the service is unofficial and often slow.";

const RowSchema = z.object({
    id: z.number().optional(),
    issuer_name: z.string().optional(),
    common_name: z.string().nullish(),
    name_value: z.string().nullish(),
    not_before: z.string().optional(),
});
export const CrtShSchema = z.array(RowSchema);
export type CrtShRow = z.infer<typeof RowSchema>;

const day = (value: string | undefined) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined);

/** "C=US, O=Let's Encrypt, CN=R3" -> "Let's Encrypt" (falls back to the whole string). */
function issuerLabel(issuerName: string): string {
    return /(?:^|,\s*)O=([^,]+)/.exec(issuerName)?.[1]?.trim() ?? issuerName;
}

/** Turns crt.sh rows into findings for `domain`. Pure. */
export function toFindings(rows: readonly CrtShRow[], domain: string): { findings: Finding[]; truncatedNames: boolean } {
    const names = new Set<string>();
    for (const row of rows) {
        for (const raw of [...(row.name_value ?? "").split("\n"), row.common_name ?? ""]) {
            const name = raw.trim().toLowerCase().replace(/^\*\./, "");
            if (name === domain || name.endsWith(`.${domain}`)) names.add(name);
        }
    }
    const subdomains = [...names].filter((name) => name !== domain).sort();

    const findings: Finding[] = [];
    if (subdomains.length > 0) {
        findings.push({
            id: "crtsh:subdomains",
            title: `Subdomains seen in certificates (${subdomains.length})`,
            severity: "info",
            category: "certificates",
            detail: "Names that appeared on publicly logged certificates. Some may no longer exist, and internal names sometimes leak here.",
            data: { subdomains: subdomains.slice(0, MAX_NAMES_SHOWN) },
        });
    }

    // crt.sh can list one certificate in several rows (one per name), so count each certificate once
    const certificates = new Map<string, CrtShRow>();
    for (const row of rows) certificates.set(String(row.id ?? `${row.not_before}|${row.name_value}`), row);

    const issued = [...certificates.values()].map((row) => day(row.not_before)).filter((d): d is string => d !== undefined).sort();
    const issuers = new Map<string, number>();
    for (const row of certificates.values()) {
        if (!row.issuer_name) continue;
        const label = issuerLabel(row.issuer_name);
        issuers.set(label, (issuers.get(label) ?? 0) + 1);
    }
    const topIssuers = [...issuers.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, MAX_ISSUERS_SHOWN).map(([name]) => name);

    if (rows.length > 0) {
        findings.push({
            id: "crtsh:certificates",
            title: `Certificates logged (${certificates.size})`,
            severity: "info",
            category: "certificates",
            data: {
                ...(issued.length > 0 && { first_issued: [issued[0]], latest_issued: [issued[issued.length - 1]] }),
                ...(topIssuers.length > 0 && { main_issuers: topIssuers }),
            },
        });
    }

    return { findings, truncatedNames: subdomains.length > MAX_NAMES_SHOWN };
}

export const crtsh: Provider = {
    id: "crtsh",

    // Subdomain data is about the domain behind a domain or URL input, not about an email address
    supports: (input) => input.kind !== "email" && targetOf(input).kind === "domain",

    async lookup(input, ctx): Promise<ProviderOutcome> {
        const target = targetOf(input);
        const domain = target.kind === "domain" ? (registrableDomain(target.value) ?? target.value) : null;
        if (!domain) throw new ProviderError("error", "Unsupported input type.");

        // "%.example.com" matches the domain's subdomains; the % must itself be URL-encoded
        const url = `${BASE_URL}?q=${encodeURIComponent(`%.${domain}`)}&output=json`;
        const { status, json } = await getJson(url, ctx, { maxBytes: MAX_BYTES });

        const scope = target.value !== domain ? `Searched the whole registered domain ${domain}.` : undefined;
        const base = joinNotes(targetNote(input), scope);

        if (status === 404 || json === null) {
            return { status: "no-data", findings: [], freshness: FRESHNESS, note: joinNotes(base, "No certificates found in the logs.") };
        }

        const rows = CrtShSchema.parse(json);
        const { findings, truncatedNames } = toFindings(rows, domain);
        if (findings.length === 0) {
            return { status: "no-data", findings: [], freshness: FRESHNESS, note: joinNotes(base, "No certificates found in the logs.") };
        }

        const incomplete =
            rows.length >= ROW_LIMIT_HINT || truncatedNames
                ? "crt.sh limits how many results it returns, so this list may be incomplete."
                : undefined;
        return { status: "ok", findings, freshness: FRESHNESS, note: joinNotes(base, incomplete) };
    },
};
