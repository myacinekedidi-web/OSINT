/**
 * Human-readable names for the lookup UI. Client-safe: no zod, no runtime imports.
 * Add one SOURCE_INFO entry per provider (a test fails until you do).
 */

import type { FindingCategory, Severity, SourceId, SourceStatus } from "./report";

export type SourceInfo = {
    name: string;
    /** Home page of the data source, shown as a link. */
    url: string;
    /** What kind of input it handles, in a few words. */
    covers: string;
};

export const SOURCE_INFO: Record<SourceId, SourceInfo> = {
    rdap: { name: "RDAP (domain registration)", url: "https://about.rdap.org/", covers: "domains, and the domain part of URLs and emails" },
    dns: {
        name: "DNS lookup (Cloudflare, Google as backup)",
        url: "https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/",
        covers: "domains, and the domain part of URLs and emails",
    },
    internetdb: { name: "Shodan InternetDB", url: "https://internetdb.shodan.io/", covers: "IPv4 addresses, and the addresses domains and URLs resolve to" },
    crtsh: { name: "crt.sh (Certificate Transparency)", url: "https://crt.sh/", covers: "domains and URLs" },
};

/** Falls back to the raw id so a report from a newer server never breaks an older page. */
export function sourceName(id: string): string {
    return (SOURCE_INFO as Record<string, SourceInfo | undefined>)[id]?.name ?? id;
}

export function sourceUrl(id: string): string | undefined {
    return (SOURCE_INFO as Record<string, SourceInfo | undefined>)[id]?.url;
}

export const STATUS_LABEL: Record<SourceStatus, string> = {
    ok: "Data found",
    "no-data": "No data",
    unsupported: "Not applicable",
    unconfigured: "Not configured",
    "rate-limited": "Rate limited",
    timeout: "Timed out",
    error: "Error",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
    info: "Info",
    low: "Low",
    medium: "Medium",
    high: "High",
    critical: "Critical",
};

export const CATEGORY_LABEL: Record<FindingCategory, string> = {
    exposure: "Exposure",
    vulnerability: "Vulnerability",
    infrastructure: "Infrastructure",
    registration: "Registration",
    dns: "DNS",
    certificates: "Certificates",
};

/** "ports" -> "Ports", "http_headers" -> "Http headers". */
export function humanizeKey(key: string): string {
    const spaced = key.replace(/[_-]+/g, " ").trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
