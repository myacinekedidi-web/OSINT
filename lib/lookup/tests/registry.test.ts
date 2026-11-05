import { describe, expect, it } from "vitest";
import type { LookupInput } from "../detect-input";
import { runLookup } from "../lookup";
import { PROVIDERS } from "../registry";
import { SOURCE_IDS } from "../report";
import { fakeNetwork } from "./fake-network";

const NOW = () => new Date("2026-11-01T12:00:00.000Z");

describe("PROVIDERS", () => {
    it("has exactly one provider per known source id, in report order", () => {
        expect(PROVIDERS.map((p) => p.id)).toEqual(["rdap", "dns", "internetdb", "crtsh"]);
        expect([...PROVIDERS.map((p) => p.id)].sort()).toEqual([...SOURCE_IDS].sort());
    });
});

describe("which sources apply to which input", () => {
    // Every request fails: we only care which sources are listed, and their order
    const sourcesFor = async (input: LookupInput) => {
        const report = await runLookup(input, { providers: PROVIDERS, fetch: fakeNetwork([]).fetch, now: NOW });
        return report.sources.map((s) => [s.source, s.status === "unsupported" ? "unsupported" : "asked"]);
    };

    const asked = (...ids: string[]) => ids.map((id) => [id, "asked"]);

    it("IPv4: Shodan only", async () => {
        expect(await sourcesFor({ kind: "ipv4", value: "8.8.8.8" })).toEqual(asked("internetdb"));
    });

    it("IPv6: Shodan, listed as unsupported so the user knows why there is nothing", async () => {
        expect(await sourcesFor({ kind: "ipv6", value: "2606:4700:4700::1111" })).toEqual([["internetdb", "unsupported"]]);
    });

    it("domain: all four, in order", async () => {
        expect(await sourcesFor({ kind: "domain", value: "example.com" })).toEqual(asked("rdap", "dns", "internetdb", "crtsh"));
    });

    it("URL with a domain host: all four", async () => {
        expect(await sourcesFor({ kind: "url", value: "https://example.com/x", hostname: "example.com" })).toEqual(
            asked("rdap", "dns", "internetdb", "crtsh"),
        );
    });

    it("URL with an IPv4 host: Shodan only", async () => {
        expect(await sourcesFor({ kind: "url", value: "http://8.8.8.8/", hostname: "8.8.8.8" })).toEqual(asked("internetdb"));
    });

    it("URL with an IPv6 host: Shodan, listed as unsupported", async () => {
        expect(await sourcesFor({ kind: "url", value: "https://[2606:4700:4700::1111]/", hostname: "2606:4700:4700::1111" })).toEqual([
            ["internetdb", "unsupported"],
        ]);
    });

    it("email: registration and DNS only (no certificate or address scans of a mail domain)", async () => {
        expect(await sourcesFor({ kind: "email", value: "a@example.com", domain: "example.com" })).toEqual(asked("rdap", "dns"));
    });

    it("a bare public suffix: RDAP says it has nothing to register, and the other sources are still asked", async () => {
        const report = await runLookup({ kind: "domain", value: "co.uk" }, { providers: PROVIDERS, fetch: fakeNetwork([]).fetch, now: NOW });
        expect(report.sources[0]).toMatchObject({ source: "rdap", status: "unsupported" });
        expect(report.sources[0].note).toContain("public suffix");
    });
});
