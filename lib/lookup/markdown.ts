import { SEVERITY_LABEL, STATUS_LABEL, humanizeKey, sourceName } from "./labels";
import type { LookupReport } from "./report";
import { sortFindings } from "./summary";

const KIND_LABEL: Record<LookupReport["input"]["kind"], string> = {
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    domain: "domain",
    url: "URL",
    email: "email address",
};

/** Text we write ourselves: neutralize only what could break the Markdown or inject HTML. */
const text = (value: string) =>
    value.replace(/[<>`]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "`": "'" })[char] as string).replace(/\s+/g, " ").trim();

/** Anything that may come from the user or an upstream service goes in a code span. */
const code = (value: unknown) => `\`${String(value).replace(/`/g, "'").replace(/\s+/g, " ").trim()}\``;

/** Plain-text export of a report, for pasting into notes, tickets or a case file. */
export function reportToMarkdown(report: LookupReport, notice?: string): string {
    const lines: string[] = [
        "# OSINT lookup report",
        "",
        `- **Input:** ${code(report.input.value)} (${KIND_LABEL[report.input.kind]})`,
        `- **Generated:** ${text(report.generatedAt)}`,
    ];
    if (notice) lines.push(`- **Note:** ${text(notice)}`);

    if (report.sources.length === 0) {
        lines.push("", "No data sources cover this kind of input yet.");
    }

    for (const source of report.sources) {
        lines.push("", `## ${text(sourceName(source.source))}: ${STATUS_LABEL[source.status]}`);
        if (source.note) lines.push("", text(source.note));
        if (source.freshness) lines.push("", `_${text(source.freshness)}_`);

        for (const finding of sortFindings(source.findings)) {
            lines.push("", `### [${SEVERITY_LABEL[finding.severity]}] ${text(finding.title)}`);
            if (finding.detail) lines.push("", text(finding.detail));
            for (const [key, value] of Object.entries(finding.data ?? {})) {
                const items = Array.isArray(value) ? value : [value];
                lines.push(`- ${humanizeKey(key)}: ${items.map(code).join(", ")}`);
            }
        }
    }

    lines.push("", "---", "Informational only. Verify findings independently and use them lawfully.", "");
    return lines.join("\n");
}
