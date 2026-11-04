import type { LookupReport, SourceResult } from "../report";

export const GENERATED_AT = "2026-11-01T12:00:00.000Z";

export function source(overrides: Partial<SourceResult> = {}): SourceResult {
    return {
        source: "internetdb",
        status: "ok",
        findings: [],
        fetchedAt: GENERATED_AT,
        ...overrides,
    };
}

/** A realistic report for 8.8.8.8: ports, two CVEs and hostnames (3 findings, 1 source). */
export function sampleReport(overrides: Partial<LookupReport> = {}): LookupReport {
    return {
        input: { kind: "ipv4", value: "8.8.8.8" },
        generatedAt: GENERATED_AT,
        sources: [
            source({
                freshness: "Shodan InternetDB is a weekly snapshot, so this data can be several days old.",
                findings: [
                    {
                        id: "internetdb:ports",
                        title: "Open ports (3)",
                        severity: "info",
                        category: "exposure",
                        detail: "Ports that Shodan saw accepting connections on this address.",
                        data: { ports: [22, 80, 443] },
                    },
                    {
                        id: "internetdb:vulns",
                        title: "Known vulnerabilities (2)",
                        severity: "medium",
                        category: "vulnerability",
                        detail: "CVEs Shodan associates with the software it detected.",
                        data: { vulns: ["CVE-2020-15778", "CVE-2021-41773"] },
                    },
                    {
                        id: "internetdb:hostnames",
                        title: "Hostnames (1)",
                        severity: "info",
                        category: "infrastructure",
                        data: { hostnames: ["dns.google"] },
                    },
                ],
            }),
        ],
        ...overrides,
    };
}
