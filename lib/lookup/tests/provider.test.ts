import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { LookupInput } from "../detect-input";
import { ProviderError, runProvider, type Provider, type ProviderOutcome } from "../provider";
import { SourceResultSchema } from "../report";

const NOW = new Date("2026-11-01T12:00:00.000Z");
const options = { now: () => NOW };

const ipv4: LookupInput = { kind: "ipv4", value: "8.8.8.8" };
const domain: LookupInput = { kind: "domain", value: "example.com" };

function fakeProvider(lookup: Provider["lookup"], extra: Partial<Provider> = {}): Provider {
    return { id: "internetdb", supports: (input) => input.kind === "ipv4", lookup, ...extra };
}

const outcome: ProviderOutcome = {
    status: "ok",
    findings: [{ id: "x:1", title: "Thing", severity: "info", category: "exposure" }],
    freshness: "weekly",
};

describe("runProvider", () => {
    it("stamps the source and time on a successful outcome", async () => {
        const result = await runProvider(fakeProvider(async () => outcome), ipv4, options);
        expect(result).toEqual({
            source: "internetdb",
            status: "ok",
            findings: outcome.findings,
            fetchedAt: "2026-11-01T12:00:00.000Z",
            freshness: "weekly",
        });
        expect(SourceResultSchema.safeParse(result).success).toBe(true);
    });

    it("passes through a no-data outcome and its note", async () => {
        const result = await runProvider(fakeProvider(async () => ({ status: "no-data", findings: [], note: "Nothing known." })), ipv4, options);
        expect(result).toMatchObject({ status: "no-data", findings: [], note: "Nothing known." });
    });

    it("hands the provider a signal, a fetch and the clock", async () => {
        const lookup = vi.fn(async () => outcome);
        const fetchImpl = vi.fn() as unknown as typeof fetch;
        await runProvider(fakeProvider(lookup), ipv4, { ...options, fetch: fetchImpl });

        const ctx = (lookup.mock.calls[0] as unknown as [LookupInput, { signal: AbortSignal; fetch: typeof fetch; now: () => Date }])[1];
        expect(ctx.fetch).toBe(fetchImpl);
        expect(ctx.signal).toBeInstanceOf(AbortSignal);
        expect(ctx.now()).toBe(NOW);
    });

    describe("unsupported input", () => {
        it("does not call the provider and says why", async () => {
            const lookup = vi.fn(async () => outcome);
            const provider = fakeProvider(lookup, { unsupportedNote: () => "IPv4 only." });
            const result = await runProvider(provider, { kind: "ipv6", value: "2606:4700:4700::1111" }, options);

            expect(lookup).not.toHaveBeenCalled();
            expect(result).toMatchObject({ status: "unsupported", findings: [], note: "IPv4 only." });
        });

        it("falls back to a generic note", async () => {
            const result = await runProvider(fakeProvider(async () => outcome), domain, options);
            expect(result.status).toBe("unsupported");
            expect(result.note).toBeTruthy();
        });
    });

    describe("failures never throw", () => {
        it.each(["rate-limited", "error", "unconfigured", "timeout"] as const)("maps ProviderError(%s)", async (status) => {
            const provider = fakeProvider(async () => {
                throw new ProviderError(status, "Explained.");
            });
            expect(await runProvider(provider, ipv4, options)).toMatchObject({ status, note: "Explained.", findings: [] });
        });

        it("maps a provider that outlasts the timeout", async () => {
            const provider = fakeProvider(
                (_input, ctx) =>
                    new Promise((_resolve, reject) => {
                        ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason));
                    }),
            );
            const result = await runProvider(provider, ipv4, { ...options, timeoutMs: 20 });
            expect(result).toMatchObject({ status: "timeout" });
        });

        it("maps an aborted fetch (AbortError)", async () => {
            const provider = fakeProvider(async () => {
                throw new DOMException("aborted", "AbortError");
            });
            expect((await runProvider(provider, ipv4, options)).status).toBe("timeout");
        });

        it("maps a response that fails validation", async () => {
            const provider = fakeProvider(async () => {
                z.object({ ports: z.array(z.number()) }).parse({ ports: "not a list" });
                return outcome;
            });
            const result = await runProvider(provider, ipv4, options);
            expect(result.status).toBe("error");
            expect(result.note).toContain("unexpected format");
        });

        it("hides the cause of an unexpected exception", async () => {
            const provider = fakeProvider(async () => {
                throw new Error("connect ECONNREFUSED 10.1.2.3:443 secret-token-abc");
            });
            const result = await runProvider(provider, ipv4, options);
            expect(result.status).toBe("error");
            expect(JSON.stringify(result)).not.toContain("secret-token-abc");
            expect(JSON.stringify(result)).not.toContain("10.1.2.3");
        });

        it("handles a provider that throws something that is not an Error", async () => {
            const provider = fakeProvider(async () => {
                throw "just a string";
            });
            expect((await runProvider(provider, ipv4, options)).status).toBe("error");
        });
    });
});