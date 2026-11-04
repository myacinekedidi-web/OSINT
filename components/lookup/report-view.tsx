"use client";

import type { ComponentType, Ref } from "react";
import {
    Ban,
    CircleCheck,
    CircleDashed,
    Clock,
    Copy,
    ExternalLink,
    Gauge,
    KeyRound,
    TriangleAlert,
    type LucideProps,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { detectInput, INPUT_KIND_LABEL } from "@/lib/lookup/detect-input";
import {
    CATEGORY_LABEL,
    SEVERITY_LABEL,
    STATUS_LABEL,
    humanizeKey,
    sourceName,
    sourceUrl,
} from "@/lib/lookup/labels";
import { reportToMarkdown } from "@/lib/lookup/markdown";
import type { Finding, LookupReport, Severity, SourceResult, SourceStatus } from "@/lib/lookup/report";
import { SEVERITIES_DESCENDING, describeSummary, sortFindings, summarizeReport } from "@/lib/lookup/summary";

const STATUS_STYLE: Record<SourceStatus, { Icon: ComponentType<LucideProps>; className: string }> = {
    ok: { Icon: CircleCheck, className: "bg-green-500/15 text-green-800 dark:text-green-300" },
    "no-data": { Icon: CircleDashed, className: "bg-muted text-muted-foreground" },
    unsupported: { Icon: Ban, className: "bg-muted text-muted-foreground" },
    unconfigured: { Icon: KeyRound, className: "bg-muted text-muted-foreground" },
    "rate-limited": { Icon: Gauge, className: "bg-yellow-400/20 text-yellow-800 dark:text-yellow-300" },
    timeout: { Icon: Clock, className: "bg-yellow-400/20 text-yellow-800 dark:text-yellow-300" },
    error: { Icon: TriangleAlert, className: "bg-destructive/10 text-destructive" },
};

const SEVERITY_STYLE: Record<Severity, string> = {
    info: "bg-muted text-muted-foreground",
    low: "bg-blue-500/15 text-blue-800 dark:text-blue-300",
    medium: "bg-yellow-400/20 text-yellow-800 dark:text-yellow-300",
    high: "bg-orange-500/20 text-orange-800 dark:text-orange-300",
    critical: "bg-destructive/10 text-destructive",
};

const CVE_ID = /^CVE-\d{4}-\d{4,}$/;

/** Status is always written out, never conveyed by color alone. */
function StatusChip({ status }: { status: SourceStatus }) {
    const { Icon, className } = STATUS_STYLE[status];
    return (
        <Badge variant="secondary" className={className}>
            <Icon aria-hidden="true" />
            {STATUS_LABEL[status]}
        </Badge>
    );
}

function SeverityBadge({ severity }: { severity: Severity }) {
    return (
        <Badge variant="secondary" className={SEVERITY_STYLE[severity]}>
            {SEVERITY_LABEL[severity]}
        </Badge>
    );
}

const chipClass = "rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs break-all";

function DataItem({ dataKey, value }: { dataKey: string; value: unknown }) {
    const items = Array.isArray(value) ? value : [value];
    return (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <dt className="text-xs text-muted-foreground">{humanizeKey(dataKey)}</dt>
            <dd>
                <ul className="flex flex-wrap gap-1">
                    {items.map((item, index) => {
                        const label = typeof item === "string" || typeof item === "number" ? String(item) : JSON.stringify(item);
                        return (
                            <li key={`${label}-${index}`}>
                                {typeof item === "string" && CVE_ID.test(item) ? (
                                    // Only well-formed CVE ids are ever turned into links
                                    <a
                                        href={`https://nvd.nist.gov/vuln/detail/${item}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        aria-label={`${item} (opens the NVD entry in a new tab)`}
                                        className={`${chipClass} inline-flex items-center gap-1 underline-offset-2 hover:underline`}
                                    >
                                        {item}
                                        <ExternalLink aria-hidden="true" className="size-3" />
                                    </a>
                                ) : (
                                    <code className={chipClass}>{label}</code>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </dd>
        </div>
    );
}

function FindingItem({ finding }: { finding: Finding }) {
    const data = Object.entries(finding.data ?? {});
    return (
        <li className="space-y-1.5 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={finding.severity} />
                <h4 className="text-sm font-medium">{finding.title}</h4>
                <span className="text-xs text-muted-foreground">{CATEGORY_LABEL[finding.category] ?? finding.category}</span>
            </div>
            {finding.detail && <p className="text-sm text-muted-foreground">{finding.detail}</p>}
            {data.length > 0 && (
                <dl className="space-y-1">
                    {data.map(([key, value]) => (
                        <DataItem key={key} dataKey={key} value={value} />
                    ))}
                </dl>
            )}
        </li>
    );
}

function SourceCard({ source }: { source: SourceResult }) {
    const url = sourceUrl(source.source);
    return (
        <li className="space-y-2 rounded-xl border p-4">
            <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold">{sourceName(source.source)}</h3>
                <StatusChip status={source.status} />
                {url && (
                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                        Source
                        <ExternalLink aria-hidden="true" className="size-3" />
                        <span className="sr-only">(opens in a new tab)</span>
                    </a>
                )}
            </div>
            {source.note && <p className="text-sm">{source.note}</p>}
            {source.freshness && <p className="text-xs text-muted-foreground">{source.freshness}</p>}
            {source.findings.length > 0 && (
                <ul className="space-y-2">
                    {sortFindings(source.findings).map((finding) => (
                        <FindingItem key={finding.id} finding={finding} />
                    ))}
                </ul>
            )}
        </li>
    );
}

async function copyText(text: string, what: string) {
    try {
        await navigator.clipboard.writeText(text);
        toast.add({ type: "success", title: `${what} copied` });
    } catch {
        toast.add({ type: "error", title: "Could not copy", description: "Your browser blocked clipboard access." });
    }
}

type Props = {
    report: LookupReport;
    /** Something the user should know about how the input was read. */
    notice?: string;
    /** Receives focus after a lookup finishes, so keyboard and screen-reader users land on the result. */
    headingRef?: Ref<HTMLHeadingElement>;
};

export function ReportView({ report, notice, headingRef }: Props) {
    const summary = summarizeReport(report);
    const kindLabel = INPUT_KIND_LABEL[report.input.kind] ?? report.input.kind;
    // Reuse the router so the report can show a normalized form of long inputs
    const detected = detectInput(report.input.value);
    const shownValue = detected.ok ? detected.input.value : report.input.value;

    return (
        <section aria-labelledby="report-heading" className="space-y-4">
            <div className="space-y-1">
                <h2 id="report-heading" ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
                    Report
                </h2>
                <p className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="outline">{kindLabel}</Badge>
                    <code className="font-mono break-all">{shownValue}</code>
                </p>
                {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-1">
                    <p className="text-sm font-medium">{describeSummary(summary)}</p>
                    {summary.findings > 0 && (
                        <ul className="flex flex-wrap gap-1.5" aria-label="Findings by severity">
                            {SEVERITIES_DESCENDING.filter((severity) => summary.bySeverity[severity] > 0).map((severity) => (
                                <li key={severity}>
                                    <Badge variant="secondary" className={SEVERITY_STYLE[severity]}>
                                        {summary.bySeverity[severity]} {SEVERITY_LABEL[severity].toLowerCase()}
                                    </Badge>
                                </li>
                            ))}
                        </ul>
                    )}
                    {summary.sourcesWithProblems > 0 && (
                        <p className="text-sm text-yellow-800 dark:text-yellow-300">
                            {summary.sourcesWithProblems === 1
                                ? "One source did not answer, so this report may be incomplete."
                                : `${summary.sourcesWithProblems} sources did not answer, so this report may be incomplete.`}
                        </p>
                    )}
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => copyText(reportToMarkdown(report, notice), "Markdown")}>
                        <Copy aria-hidden="true" />
                        Copy Markdown
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => copyText(JSON.stringify(report, null, 2), "JSON")}>
                        <Copy aria-hidden="true" />
                        Copy JSON
                    </Button>
                </div>
            </div>

            {report.sources.length === 0 ? (
                <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
                    No data sources cover this kind of input yet. More sources are added over time.
                </p>
            ) : (
                <ul className="space-y-3">
                    {report.sources.map((source) => (
                        <SourceCard key={source.source} source={source} />
                    ))}
                </ul>
            )}

            <p className="text-xs text-muted-foreground">
                Generated {new Date(report.generatedAt).toLocaleString()}. Informational only: verify findings independently
                and use them lawfully.
            </p>
        </section>
    );
}
