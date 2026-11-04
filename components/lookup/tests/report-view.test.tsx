// @vitest-environment jsdom
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sampleReport, source } from "../../../lib/lookup/tests/fixtures";
import { ReportView } from "../report-view";

const toastAdd = vi.fn();
vi.mock("@/components/ui/toast", () => ({ toast: { add: (...args: unknown[]) => toastAdd(...args) } }));

beforeEach(() => toastAdd.mockClear());
afterEach(cleanup);

describe("ReportView", () => {
    it("shows the input, its type and a summary", () => {
        render(<ReportView report={sampleReport()} />);

        expect(screen.getByRole("heading", { level: 2, name: "Report" })).toBeTruthy();
        expect(screen.getByText("IPv4 address")).toBeTruthy();
        expect(screen.getByText("8.8.8.8")).toBeTruthy();
        expect(screen.getByText("3 findings from 1 source")).toBeTruthy();

        const counts = within(screen.getByRole("list", { name: "Findings by severity" }));
        expect(counts.getByText("1 medium")).toBeTruthy();
        expect(counts.getByText("2 info")).toBeTruthy();
        expect(counts.queryByText(/high|critical|low/)).toBeNull();
    });

    it("lists severity counts most severe first", () => {
        const report = sampleReport();
        report.sources[0].findings.push({ id: "x:crit", title: "Bad", severity: "critical", category: "vulnerability" });
        render(<ReportView report={report} />);

        const items = within(screen.getByRole("list", { name: "Findings by severity" })).getAllByRole("listitem");
        expect(items.map((item) => item.textContent)).toEqual(["1 critical", "1 medium", "2 info"]);
    });

    it("shows the most severe findings first within a source", () => {
        const report = sampleReport();
        report.sources[0].findings.push({ id: "x:crit", title: "Bad", severity: "critical", category: "vulnerability" });
        render(<ReportView report={report} />);

        const titles = screen.getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent);
        expect(titles).toEqual(["Bad", "Known vulnerabilities (2)", "Open ports (3)", "Hostnames (1)"]);
    });

    it("renders each source with its status written out, and its findings", () => {
        render(<ReportView report={sampleReport()} />);

        expect(screen.getByRole("heading", { level: 3, name: "Shodan InternetDB" })).toBeTruthy();
        expect(screen.getByText("Data found")).toBeTruthy();
        expect(screen.getByText(/weekly snapshot/)).toBeTruthy();
        expect(screen.getByRole("heading", { level: 4, name: "Open ports (3)" })).toBeTruthy();
        expect(screen.getByRole("heading", { level: 4, name: "Known vulnerabilities (2)" })).toBeTruthy();
        for (const port of ["22", "80", "443"]) expect(screen.getByText(port)).toBeTruthy();
        expect(screen.getByText("dns.google")).toBeTruthy();
    });

    it("links the data source's home page safely", () => {
        render(<ReportView report={sampleReport()} />);
        const link = screen.getByRole("link", { name: /Source/ });
        expect(link.getAttribute("href")).toBe("https://internetdb.shodan.io/");
        expect(link.getAttribute("target")).toBe("_blank");
        expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    });

    describe("CVE ids", () => {
        it("link to the NVD entry", () => {
            render(<ReportView report={sampleReport()} />);
            const link = screen.getByRole("link", { name: /CVE-2021-41773/ });
            expect(link.getAttribute("href")).toBe("https://nvd.nist.gov/vuln/detail/CVE-2021-41773");
            expect(link.getAttribute("rel")).toBe("noopener noreferrer");
        });

        it("only turn well-formed ids into links", () => {
            const report = sampleReport({
                sources: [
                    source({
                        findings: [
                            {
                                id: "internetdb:vulns",
                                title: "Known vulnerabilities (3)",
                                severity: "medium",
                                category: "vulnerability",
                                data: { vulns: ["javascript:alert(1)", "CVE-1-2", "CVE-2021-41773/../../evil"] },
                            },
                        ],
                    }),
                ],
            });
            render(<ReportView report={report} />);

            expect(screen.queryByRole("link", { name: /CVE|javascript/ })).toBeNull();
            expect(screen.getByText("javascript:alert(1)").tagName).toBe("CODE");
            expect(screen.getByText("CVE-1-2")).toBeTruthy();
        });
    });

    it("shows hostile upstream text as text, never as markup", () => {
        const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
        const report = sampleReport({
            sources: [
                source({
                    note: payload,
                    findings: [
                        { id: "x:1", title: payload, severity: "info", category: "infrastructure", detail: payload, data: { hostnames: [payload] } },
                    ],
                }),
            ],
        });
        const { container } = render(<ReportView report={report} />);

        expect(container.querySelector("img")).toBeNull();
        expect(container.querySelector("script")).toBeNull();
        expect(screen.getAllByText(payload).length).toBeGreaterThanOrEqual(3);
    });

    it("explains an empty report", () => {
        render(<ReportView report={sampleReport({ sources: [] })} />);
        expect(screen.getByText("No data sources cover this input yet")).toBeTruthy();
        expect(screen.getByText(/No data sources cover this kind of input yet/)).toBeTruthy();
    });

    it("shows the router's notice", () => {
        render(<ReportView report={sampleReport()} notice="No scheme given: assumed https://" />);
        expect(screen.getByText("No scheme given: assumed https://")).toBeTruthy();
    });

    describe("sources that did not deliver", () => {
        it.each([
            ["timeout", "Timed out"],
            ["rate-limited", "Rate limited"],
            ["error", "Error"],
            ["no-data", "No data"],
            ["unsupported", "Not applicable"],
            ["unconfigured", "Not configured"],
        ] as const)("labels %s as %s and shows the note", (status, label) => {
            const report = sampleReport({ sources: [source({ status, note: "Explained for the reader." })] });
            render(<ReportView report={report} />);
            expect(screen.getByText(label)).toBeTruthy();
            expect(screen.getByText("Explained for the reader.")).toBeTruthy();
        });

        it("warns that the report may be incomplete only for real failures", () => {
            const { unmount } = render(<ReportView report={sampleReport({ sources: [source({ status: "timeout" })] })} />);
            expect(screen.getByText("One source did not answer, so this report may be incomplete.")).toBeTruthy();
            unmount();

            render(<ReportView report={sampleReport({ sources: [source({ status: "no-data" }), source({ status: "unsupported" })] })} />);
            expect(screen.queryByText(/may be incomplete/)).toBeNull();
        });
    });

    it("copes with a source or category a newer server added", () => {
        const report = sampleReport({
            sources: [
                {
                    ...source({ findings: [{ id: "x:1", title: "Odd", severity: "info", category: "exposure" }] }),
                    source: "brand-new" as never,
                },
            ],
        });
        render(<ReportView report={report} />);
        expect(screen.getByRole("heading", { level: 3, name: "brand-new" })).toBeTruthy();
        expect(screen.queryByRole("link", { name: /Source/ })).toBeNull();
    });

    it("hands its heading to the caller so focus can move there", () => {
        const ref = createRef<HTMLHeadingElement>();
        render(<ReportView report={sampleReport()} headingRef={ref} />);
        ref.current?.focus();
        expect(document.activeElement).toBe(ref.current);
        expect(ref.current?.textContent).toBe("Report");
    });

    describe("copy buttons", () => {
        it("copy the Markdown export", async () => {
            const user = userEvent.setup();
            const writeText = vi.spyOn(navigator.clipboard, "writeText");
            render(<ReportView report={sampleReport()} notice="n" />);

            await user.click(screen.getByRole("button", { name: "Copy Markdown" }));

            expect(writeText).toHaveBeenCalledOnce();
            expect(writeText.mock.calls[0][0]).toContain("# OSINT lookup report");
            expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Markdown copied" }));
        });

        it("copy the report as JSON", async () => {
            const user = userEvent.setup();
            const writeText = vi.spyOn(navigator.clipboard, "writeText");
            const report = sampleReport();
            render(<ReportView report={report} />);

            await user.click(screen.getByRole("button", { name: "Copy JSON" }));

            expect(JSON.parse(writeText.mock.calls[0][0])).toEqual(report);
            expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: "JSON copied" }));
        });

        it("say so, instead of failing silently, when the browser blocks the clipboard", async () => {
            const user = userEvent.setup();
            vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
            render(<ReportView report={sampleReport()} />);

            await user.click(screen.getByRole("button", { name: "Copy JSON" }));

            expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title: "Could not copy" }));
        });
    });
});
