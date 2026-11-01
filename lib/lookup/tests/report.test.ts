import { describe, expect, it } from "vitest";
import { FindingSchema, LookupReportSchema, SourceResultSchema } from "../report";

const finding = {
    id: "internetdb:ports",
    title: "Open ports (2)",
    severity: "info",
    category: "exposure",
    data: { ports: [80, 443] },
};

const source = {
    source: "internetdb",
    status: "ok",
    findings: [finding],
    fetchedAt: "2026-11-01T12:00:00.000Z",
};

describe("report schemas", () => {
    it("accepts a complete report", () => {
        const report = {
            input: { kind: "ipv4", value: "8.8.8.8" },
            sources: [source],
            generatedAt: "2026-11-01T12:00:01.000Z",
        };
        expect(LookupReportSchema.parse(report)).toEqual(report);
    });

    it("accepts a source that reports a problem instead of findings", () => {
        const parsed = SourceResultSchema.parse({ ...source, status: "timeout", findings: [], note: "No answer." });
        expect(parsed.status).toBe("timeout");
    });

    it.each([
        ["severity", { severity: "catastrophic" }],
        ["category", { category: "vibes" }],
        ["id", { id: "" }],
    ])("rejects a finding with a bad %s", (_name, override) => {
        expect(FindingSchema.safeParse({ ...finding, ...override }).success).toBe(false);
    });

    it("rejects an unknown status or source", () => {
        expect(SourceResultSchema.safeParse({ ...source, status: "maybe" }).success).toBe(false);
        expect(SourceResultSchema.safeParse({ ...source, source: "nope" }).success).toBe(false);
    });
});