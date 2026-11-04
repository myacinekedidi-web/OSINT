import { describe, expect, it } from "vitest";
import type { Finding } from "../report";
import { SEVERITIES_DESCENDING, describeSummary, severityRank, sortFindings, summarizeReport } from "../summary";
import { sampleReport, source } from "./fixtures";

describe("summarizeReport", () => {
    it("counts findings, sources and severities", () => {
        expect(summarizeReport(sampleReport())).toEqual({
            findings: 3,
            sources: 1,
            sourcesWithData: 1,
            sourcesWithProblems: 0,
            bySeverity: { info: 2, low: 0, medium: 1, high: 0, critical: 0 },
        });
    });

    it("counts sources that failed to answer, but not ones that merely had nothing", () => {
        const report = sampleReport({
            sources: [
                source({ status: "timeout" }),
                source({ status: "rate-limited" }),
                source({ status: "error" }),
                source({ status: "no-data" }),
                source({ status: "unsupported" }),
                source({ status: "unconfigured" }),
            ],
        });
        const summary = summarizeReport(report);
        expect(summary.sources).toBe(6);
        expect(summary.sourcesWithProblems).toBe(3);
        expect(summary.sourcesWithData).toBe(0);
    });

    it("handles a report without sources", () => {
        expect(summarizeReport(sampleReport({ sources: [] }))).toMatchObject({ findings: 0, sources: 0 });
    });
});

describe("describeSummary", () => {
    it("describes findings and sources, singular and plural", () => {
        expect(describeSummary(summarizeReport(sampleReport()))).toBe("3 findings from 1 source");

        const one = sampleReport();
        one.sources[0].findings = one.sources[0].findings.slice(0, 1);
        expect(describeSummary(summarizeReport(one))).toBe("1 finding from 1 source");
    });

    it("says so when nothing was found or nothing applies", () => {
        expect(describeSummary(summarizeReport(sampleReport({ sources: [source({ status: "no-data" })] })))).toBe(
            "No findings from 1 source",
        );
        expect(describeSummary(summarizeReport(sampleReport({ sources: [] })))).toBe(
            "No data sources cover this input yet",
        );
    });
});

describe("sortFindings", () => {
    const finding = (id: string, severity: Finding["severity"]): Finding => ({ id, title: id, severity, category: "exposure" });

    it("puts the most severe findings first", () => {
        const sorted = sortFindings([finding("a", "info"), finding("b", "critical"), finding("c", "medium"), finding("d", "high"), finding("e", "low")]);
        expect(sorted.map((f) => f.id)).toEqual(["b", "d", "c", "e", "a"]);
    });

    it("keeps the provider's order among findings of equal severity", () => {
        const sorted = sortFindings([finding("a", "info"), finding("b", "medium"), finding("c", "info"), finding("d", "medium")]);
        expect(sorted.map((f) => f.id)).toEqual(["b", "d", "a", "c"]);
    });

    it("does not change the array it was given", () => {
        const input = [finding("a", "info"), finding("b", "high")];
        sortFindings(input);
        expect(input.map((f) => f.id)).toEqual(["a", "b"]);
    });

    it("handles an empty list", () => {
        expect(sortFindings([])).toEqual([]);
    });
});

describe("severity order", () => {
    it("ranks info lowest and critical highest", () => {
        expect(severityRank("info")).toBeLessThan(severityRank("low"));
        expect(severityRank("high")).toBeLessThan(severityRank("critical"));
    });

    it("lists severities from most to least serious for display", () => {
        expect(SEVERITIES_DESCENDING).toEqual(["critical", "high", "medium", "low", "info"]);
    });
});
