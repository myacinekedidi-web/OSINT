import { describe, expect, it } from "vitest";
import type { LookupInput } from "../detect-input";
import { runLookup } from "../lookup";
import { ProviderError, type Provider } from "../provider";
import { LookupReportSchema, type SourceId } from "../report";

const NOW = () => new Date("2026-11-01T12:00:00.000Z");
const ipv4: LookupInput = { kind: "ipv4", value: "8.8.8.8" };
const ipv6: LookupInput = { kind: "ipv6", value: "2606:4700:4700::1111" };
const domain: LookupInput = { kind: "domain", value: "example.com" };

function provider(id: SourceId, kinds: LookupInput["kind"][], extra: Partial<Provider> = {}): Provider {
    return {
        id,
        supports: (input) => kinds.includes(input.kind),
        lookup: async () => ({
            status: "ok",
            findings: [{ id: `${id}:1`, title: id, severity: "info", category: "exposure" }],
        }),
        ...extra,
    };
}

describe("runLookup", () => {
    it("returns a valid report that echoes the input", async () => {
        const report = await runLookup(ipv4, { providers: [provider("internetdb", ["ipv4"])], now: NOW });

        expect(LookupReportSchema.safeParse(report).success).toBe(true);
        expect(report.input).toEqual({ kind: "ipv4", value: "8.8.8.8" });
        expect(report.generatedAt).toBe("2026-11-01T12:00:00.000Z");
        expect(report.sources).toHaveLength(1);
        expect(report.sources[0]).toMatchObject({ source: "internetdb", status: "ok" });
    });

    it("keeps the echoed input free of extra fields", async () => {
        const url: LookupInput = { kind: "url", value: "https://example.com/", hostname: "example.com" };
        const report = await runLookup(url, { providers: [], now: NOW });
        expect(report.input).toEqual({ kind: "url", value: "https://example.com/" });
    });

    it("skips providers that do not apply and gives an empty list when none do", async () => {
        const report = await runLookup(domain, { providers: [provider("internetdb", ["ipv4"])], now: NOW });
        expect(report.sources).toEqual([]);
    });

    it("lists a provider that cannot handle the input but explains why", async () => {
        const explained = provider("internetdb", ["ipv4"], { unsupportedNote: (i) => (i.kind === "ipv6" ? "IPv4 only." : undefined) });
        const report = await runLookup(ipv6, { providers: [explained], now: NOW });
        expect(report.sources).toEqual([
            expect.objectContaining({ source: "internetdb", status: "unsupported", note: "IPv4 only." }),
        ]);
    });

    it("runs providers in parallel and keeps their order", async () => {
        const started: string[] = [];
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));

        const slow = (id: SourceId): Provider =>
            provider(id, ["ipv4"], {
                lookup: async () => {
                    started.push(id);
                    await gate;
                    return { status: "ok", findings: [] };
                },
            });

        const running = runLookup(ipv4, { providers: [slow("internetdb"), slow("rdap" as SourceId)], now: NOW });
        await new Promise((resolve) => setTimeout(resolve, 10));
        // Both are in flight before either has finished
        expect(started).toEqual(["internetdb", "rdap"]);

        release();
        const report = await running;
        expect(report.sources.map((s) => s.source)).toEqual(["internetdb", "rdap"]);
    });

    it("lets one failing source fail alone", async () => {
        const failing = provider("internetdb", ["ipv4"], {
            lookup: async () => {
                throw new ProviderError("rate-limited", "Slow down.");
            },
        });
        const working = provider("rdap" as SourceId, ["ipv4"]);

        const report = await runLookup(ipv4, { providers: [failing, working], now: NOW });
        expect(report.sources.map((s) => [s.source, s.status])).toEqual([
            ["internetdb", "rate-limited"],
            ["rdap", "ok"],
        ]);
    });

    it("passes the injected fetch and timeout to the providers", async () => {
        let seen: { fetch: unknown; aborted: boolean } | undefined;
        const spy = provider("internetdb", ["ipv4"], {
            lookup: async (_input, ctx) => {
                seen = { fetch: ctx.fetch, aborted: ctx.signal.aborted };
                await new Promise((resolve) => setTimeout(resolve, 60));
                seen.aborted = ctx.signal.aborted;
                return { status: "ok", findings: [] };
            },
        });
        const fakeFetch = (() => {}) as unknown as typeof fetch;

        await runLookup(ipv4, { providers: [spy], fetch: fakeFetch, timeoutMs: 20, now: NOW });
        expect(seen?.fetch).toBe(fakeFetch);
        expect(seen?.aborted).toBe(true); // the 20 ms deadline had passed by the time the provider finished
    });
});
