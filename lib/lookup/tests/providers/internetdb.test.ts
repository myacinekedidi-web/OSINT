import { describe, expect, it, vi } from "vitest";
import { runProvider } from "../../provider";
import { SourceResultSchema } from "../../report";
import { InternetDbSchema, internetDb, toFindings } from "../../providers/internetdb";

const NOW = () => new Date("2026-11-01T12:00:00.000Z");
const ip = { kind: "ipv4", value: "151.101.41.140" } as const;

/** Shape of the real service's answer (see https://blog.shodan.io/introducing-the-internetdb-api/). */
const cdnRecord = { cpes: [], hostnames: [], ip: "151.101.41.140", ports: [80, 443], tags: ["cdn"], vulns: [] };

/** A synthetic record that exercises every field. */
const fullRecord = {
    ip: "203.0.113.10",
    ports: [443, 22, 80],
    cpes: ["cpe:/a:openbsd:openssh:8.2", "cpe:/a:apache:http_server:2.4.41"],
    hostnames: ["web.example.net"],
    tags: ["cloud"],
    vulns: ["CVE-2021-41773", "CVE-2020-15778"],
};

function fetchReturning(body: unknown, init: ResponseInit = { status: 200 }) {
    return vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), init)) as unknown as typeof fetch;
}

const run = (fetchImpl: typeof fetch, input: Parameters<typeof runProvider>[1] = ip, timeoutMs?: number) =>
    runProvider(internetDb, input, { fetch: fetchImpl, now: NOW, timeoutMs });

describe("InternetDbSchema", () => {
    it("fills in missing lists and ignores unknown fields", () => {
        expect(InternetDbSchema.parse({ ip: "1.2.3.4", extra: true })).toEqual({
            ip: "1.2.3.4",
            ports: [],
            cpes: [],
            hostnames: [],
            tags: [],
            vulns: [],
        });
    });

    it.each([
        ["ports as strings", { ip: "1.2.3.4", ports: ["80"] }],
        ["a port out of range", { ip: "1.2.3.4", ports: [70000] }],
        ["no ip", { ports: [80] }],
        ["vulns as a string", { ip: "1.2.3.4", vulns: "CVE-1" }],
    ])("rejects %s", (_name, record) => {
        expect(InternetDbSchema.safeParse(record).success).toBe(false);
    });
});

describe("toFindings", () => {
    it("produces nothing for an empty record", () => {
        expect(toFindings(InternetDbSchema.parse({ ip: "1.2.3.4" }))).toEqual([]);
    });

    it("only produces findings for the lists that have content", () => {
        const findings = toFindings(InternetDbSchema.parse(cdnRecord));
        expect(findings.map((f) => f.id)).toEqual(["internetdb:ports", "internetdb:tags"]);
    });

    it("sorts ports and CVEs and flags vulnerabilities", () => {
        const findings = toFindings(InternetDbSchema.parse(fullRecord));
        const byId = Object.fromEntries(findings.map((f) => [f.id, f]));

        expect(byId["internetdb:ports"].data).toEqual({ ports: [22, 80, 443] });
        expect(byId["internetdb:ports"].title).toBe("Open ports (3)");
        expect(byId["internetdb:vulns"].data).toEqual({ vulns: ["CVE-2020-15778", "CVE-2021-41773"] });
        expect(byId["internetdb:vulns"].severity).toBe("medium");
        expect(byId["internetdb:vulns"].category).toBe("vulnerability");
        expect(byId["internetdb:vulns"].detail).toContain("may not apply");
    });

    it("does not mutate the record it was given", () => {
        const record = InternetDbSchema.parse(fullRecord);
        toFindings(record);
        expect(record.ports).toEqual([443, 22, 80]);
    });
});

describe("internetDb provider", () => {
    it("supports IPv4 only, and explains the IPv6 case", () => {
        expect(internetDb.supports(ip)).toBe(true);
        expect(internetDb.supports({ kind: "ipv6", value: "2606:4700:4700::1111" })).toBe(false);
        expect(internetDb.supports({ kind: "domain", value: "example.com" })).toBe(false);
        expect(internetDb.unsupportedNote?.({ kind: "ipv6", value: "2606:4700:4700::1111" })).toContain("IPv4");
        expect(internetDb.unsupportedNote?.({ kind: "domain", value: "example.com" })).toBeUndefined();
    });

    it("returns findings for a known address", async () => {
        const result = await run(fetchReturning(fullRecord));
        expect(result.status).toBe("ok");
        expect(result.source).toBe("internetdb");
        expect(result.findings).toHaveLength(5);
        expect(result.freshness).toContain("weekly");
        expect(SourceResultSchema.safeParse(result).success).toBe(true);
    });

    it("calls the service with exactly the IP in the path", async () => {
        const fetchImpl = fetchReturning(cdnRecord);
        await run(fetchImpl);
        const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://internetdb.shodan.io/151.101.41.140");
        expect(init.redirect).toBe("error");
    });

    it("reports no-data when Shodan answers 404", async () => {
        const result = await run(fetchReturning({ detail: "No information available" }, { status: 404 }));
        expect(result).toMatchObject({ status: "no-data", findings: [] });
        expect(result.note).toContain("no information");
    });

    it("reports no-data when the record is empty", async () => {
        const result = await run(fetchReturning({ ip: "151.101.41.140", ports: [], hostnames: [], cpes: [], tags: [], vulns: [] }));
        expect(result).toMatchObject({ status: "no-data", findings: [] });
    });

    it("does not call the network for IPv6", async () => {
        const fetchImpl = fetchReturning(cdnRecord);
        const result = await run(fetchImpl, { kind: "ipv6", value: "2606:4700:4700::1111" });
        expect(result.status).toBe("unsupported");
        expect(result.note).toContain("IPv4");
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("turns an unexpected response shape into an error, not a crash", async () => {
        const result = await run(fetchReturning({ ip: "151.101.41.140", ports: ["80", "443"] }));
        expect(result.status).toBe("error");
        expect(result.note).toContain("unexpected format");
    });

    it("turns a non-JSON answer into an error", async () => {
        const result = await run(fetchReturning("<html>Bad gateway</html>", { status: 200 }));
        expect(result.status).toBe("error");
    });

    it("maps rate limiting", async () => {
        const result = await run(fetchReturning("slow down", { status: 429, headers: { "retry-after": "10" } }));
        expect(result.status).toBe("rate-limited");
        expect(result.note).toContain("10 seconds");
    });

    it("maps an upstream failure", async () => {
        expect((await run(fetchReturning("oops", { status: 503 }))).status).toBe("error");
    });

    it("maps a network failure without leaking details", async () => {
        const fetchImpl = vi.fn(async () => {
            throw new TypeError("fetch failed: ECONNRESET 151.101.41.140");
        }) as unknown as typeof fetch;
        const result = await run(fetchImpl);
        expect(result.status).toBe("error");
        expect(result.note).not.toContain("ECONNRESET");
    });

    it("maps a slow service to a timeout", async () => {
        const fetchImpl = vi.fn(
            (_url: unknown, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
                }),
        ) as unknown as typeof fetch;
        const result = await run(fetchImpl, ip, 20);
        expect(result.status).toBe("timeout");
    });
});
