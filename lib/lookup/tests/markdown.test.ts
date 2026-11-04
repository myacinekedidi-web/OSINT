import { describe, expect, it } from "vitest";
import { reportToMarkdown } from "../markdown";
import { sampleReport, source } from "./fixtures";

describe("reportToMarkdown", () => {
    it("renders the header, source sections and findings", () => {
        const md = reportToMarkdown(sampleReport());

        expect(md).toContain("# OSINT lookup report");
        expect(md).toContain("- **Input:** `8.8.8.8` (IPv4 address)");
        expect(md).toContain("- **Generated:** 2026-11-01T12:00:00.000Z");
        expect(md).toContain("## Shodan InternetDB: Data found");
        expect(md).toContain("_Shodan InternetDB is a weekly snapshot");
        expect(md).toContain("### [Info] Open ports (3)");
        expect(md).toContain("- Ports: `22`, `80`, `443`");
        expect(md).toContain("### [Medium] Known vulnerabilities (2)");
        expect(md).toContain("- Vulns: `CVE-2020-15778`, `CVE-2021-41773`");
        expect(md).toContain("Informational only.");
    });

    it("includes the notice when there is one", () => {
        expect(reportToMarkdown(sampleReport(), "No scheme given: assumed https://")).toContain(
            "- **Note:** No scheme given: assumed https://",
        );
    });

    it("explains a source that did not answer", () => {
        const md = reportToMarkdown(
            sampleReport({ sources: [source({ status: "timeout", note: "The data source did not respond in time." })] }),
        );
        expect(md).toContain("## Shodan InternetDB: Timed out");
        expect(md).toContain("The data source did not respond in time.");
    });

    it("says when no source applies", () => {
        expect(reportToMarkdown(sampleReport({ sources: [] }))).toContain("No data sources cover this kind of input yet.");
    });

    it("keeps hostile upstream or user text from breaking out of the Markdown", () => {
        const report = sampleReport({
            input: { kind: "email", value: "evil`](javascript:alert(1))@example.com" },
            sources: [
                source({
                    note: "<script>alert(1)</script> `tick`",
                    findings: [
                        {
                            id: "x:1",
                            title: "Hosts <b>bold</b>",
                            severity: "info",
                            category: "infrastructure",
                            data: { hostnames: ["a`b\nc", "<img src=x onerror=alert(1)>"] },
                        },
                    ],
                }),
            ],
        });
        const md = reportToMarkdown(report);

        expect(md).not.toContain("<script>");
        expect(md).not.toContain("<b>");
        expect(md).toContain("&lt;script&gt;");
        // Values sit inside code spans, with backticks and newlines neutralized
        expect(md).toContain("`a'b c`");
        expect(md).toContain("`<img src=x onerror=alert(1)>`");
        expect(md).toContain("- **Input:** `evil'](javascript:alert(1))@example.com` (email address)");
    });

    it("renders non-array data values too", () => {
        const md = reportToMarkdown(
            sampleReport({
                sources: [source({ findings: [{ id: "x:1", title: "T", severity: "low", category: "exposure", data: { count: 7 } }] })],
            }),
        );
        expect(md).toContain("- Count: `7`");
    });

    it("lists the most severe findings first", () => {
        const md = reportToMarkdown(sampleReport());
        // sampleReport has info (ports), medium (vulns), info (hostnames)
        expect(md.indexOf("### [Medium]")).toBeLessThan(md.indexOf("### [Info] Open ports"));
        expect(md.indexOf("### [Info] Open ports")).toBeLessThan(md.indexOf("### [Info] Hostnames"));
    });
});
