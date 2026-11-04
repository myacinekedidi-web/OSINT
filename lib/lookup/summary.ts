import { SEVERITIES, type Finding, type LookupReport, type Severity, type SourceStatus } from "./report";

export type ReportSummary = {
    findings: number;
    sources: number;
    /** Sources that returned data. */
    sourcesWithData: number;
    /** Sources that failed to answer (timeout, rate limit or error): the report may be incomplete. */
    sourcesWithProblems: number;
    bySeverity: Record<Severity, number>;
};

/** 0 for info up to 4 for critical. */
export const severityRank = (severity: Severity): number => SEVERITIES.indexOf(severity);

/** Severities from most to least serious, for display. */
export const SEVERITIES_DESCENDING: readonly Severity[] = [...SEVERITIES].reverse();

/**
 * Findings ordered most severe first. Findings of equal severity keep the order the provider
 * gave them, and the input array is left untouched.
 */
export function sortFindings(findings: readonly Finding[]): Finding[] {
    return [...findings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

const PROBLEM_STATUSES: ReadonlySet<SourceStatus> = new Set(["timeout", "rate-limited", "error"]);

export function summarizeReport(report: LookupReport): ReportSummary {
    const bySeverity = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<Severity, number>;
    let findings = 0;
    let sourcesWithData = 0;
    let sourcesWithProblems = 0;

    for (const source of report.sources) {
        if (source.status === "ok") sourcesWithData += 1;
        if (PROBLEM_STATUSES.has(source.status)) sourcesWithProblems += 1;
        for (const finding of source.findings) {
            findings += 1;
            bySeverity[finding.severity] += 1;
        }
    }

    return { findings, sources: report.sources.length, sourcesWithData, sourcesWithProblems, bySeverity };
}

/** "3 findings from 1 source", "No findings", ... used for the screen-reader announcement and the summary line. */
export function describeSummary(summary: ReportSummary): string {
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
    if (summary.sources === 0) return "No data sources cover this input yet";
    if (summary.findings === 0) return `No findings from ${plural(summary.sources, "source")}`;
    return `${plural(summary.findings, "finding")} from ${plural(summary.sourcesWithData, "source")}`;
}
