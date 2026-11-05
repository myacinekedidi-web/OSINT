import { describe, expect, it, vi } from "vitest";
import { runProvider } from "../../provider";
import { A, CNAME, doh, dohRoute, fakeNetwork as fakeNet, json as jsonReply, type Route } from "../fake-network";
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
    it("supports IPv4 addresses and the hosts of domains and URLs, and explains the IPv6 case", () => {
        expect(internetDb.supports(ip)).toBe(true);
        expect(internetDb.supports({ kind: "domain", value: "example.com" })).toBe(true);
        expect(internetDb.supports({ kind: "url", value: "https://example.com/", hostname: "example.com" })).toBe(true);
        expect(internetDb.supports({ kind: "url", value: "http://8.8.8.8/", hostname: "8.8.8.8" })).toBe(true);

        const v6 = { kind: "ipv6", value: "2606:4700:4700::1111" } as const;
        const v6Url = { kind: "url", value: "https://[2606:4700:4700::1111]/", hostname: "2606:4700:4700::1111" } as const;
        expect(internetDb.supports(v6)).toBe(false);
        expect(internetDb.supports(v6Url)).toBe(false);
        expect(internetDb.unsupportedNote?.(v6)).toContain("IPv4");
        expect(internetDb.unsupportedNote?.(v6Url)).toContain("IPv4");
    });

    it("does not apply to emails, and says nothing about them", () => {
        const email = { kind: "email", value: "a@example.com", domain: "example.com" } as const;
        expect(internetDb.supports(email)).toBe(false);
        expect(internetDb.unsupportedNote?.(email)).toBeUndefined();
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

describe("internetDb provider: domains and URLs", () => {
    const domain = { kind: "domain", value: "example.com" } as const;
    const record = (ipAddress: string, extra: Record<string, unknown> = {}) => ({ ip: ipAddress, ports: [443], cpes: [], hostnames: [], tags: [], vulns: [], ...extra });

    const routes = (overrides: Route[] = []): Route[] => [
        ...overrides,
        [dohRoute("example.com", "A"), doh([{ type: A, data: "93.184.216.34" }, { type: A, data: "93.184.216.35" }])],
        ["https://internetdb.shodan.io/93.184.216.34", jsonReply(record("93.184.216.34", { ports: [80, 443] }))],
        ["https://internetdb.shodan.io/93.184.216.35", jsonReply(record("93.184.216.35", { vulns: ["CVE-2021-41773"] }))],
    ];

    const runWith = (r: Route[], input: Parameters<typeof runProvider>[1] = domain) => {
        const network = fakeNet(r);
        return runProvider(internetDb, input, { fetch: network.fetch, now: NOW }).then((source) => ({ source, network }));
    };

    it("resolves the domain, checks each public address and labels the findings with it", async () => {
        const { source, network } = await runWith(routes());

        expect(source.status).toBe("ok");
        expect(source.findings.map((f) => f.id)).toEqual([
            "internetdb:93.184.216.34:ports",
            "internetdb:93.184.216.35:ports",
            "internetdb:93.184.216.35:vulns",
        ]);
        expect(source.findings[0].title).toBe("Open ports (2) on 93.184.216.34");
        expect(source.note).toBe("Checked the addresses example.com resolves to: 93.184.216.34, 93.184.216.35.");
        expect(network.hosts()).toEqual(["cloudflare-dns.com", "internetdb.shodan.io"]);
        expect(SourceResultSchema.safeParse(source).success).toBe(true);
    });

    it("works from a URL's host and says so", async () => {
        const { source } = await runWith(routes(), { kind: "url", value: "https://example.com/login", hostname: "example.com" });
        expect(source.status).toBe("ok");
        expect(source.note).toContain("host of the URL");
    });

    it("looks an IP-host URL up directly, without DNS", async () => {
        const { source, network } = await runWith(routes(), { kind: "url", value: "http://93.184.216.34/", hostname: "93.184.216.34" });
        expect(network.hosts()).toEqual(["internetdb.shodan.io"]);
        expect(source.findings[0].id).toBe("internetdb:ports"); // single address: no prefix
        expect(source.note).toContain("host of the URL");
    });

    it("never sends private, loopback or duplicate addresses to Shodan", async () => {
        const { source, network } = await runWith([
            [dohRoute("example.com", "A"), doh([{ type: A, data: "10.0.0.5" }, { type: A, data: "127.0.0.1" }, { type: A, data: "93.184.216.34" }, { type: A, data: "93.184.216.34" }, { type: A, data: "not-an-ip" }])],
            ["https://internetdb.shodan.io/93.184.216.34", jsonReply(record("93.184.216.34"))],
        ]);
        expect(network.urls.filter((u) => u.includes("shodan"))).toEqual(["https://internetdb.shodan.io/93.184.216.34"]);
        expect(source.status).toBe("ok");
    });

    it("checks at most three addresses", async () => {
        const answers = ["93.184.216.1", "93.184.216.2", "93.184.216.3", "93.184.216.4", "93.184.216.5"].map((data) => ({ type: A, data }));
        const shodan: Route[] = answers.map(({ data }) => [`https://internetdb.shodan.io/${data}`, jsonReply(record(data))]);
        const { network } = await runWith([[dohRoute("example.com", "A"), doh(answers)], ...shodan]);
        expect(network.urls.filter((u) => u.includes("shodan"))).toHaveLength(3);
    });

    it("explains a domain that does not exist", async () => {
        const { source, network } = await runWith([[dohRoute("example.com", "A"), doh([], 3)]]);
        expect(source).toMatchObject({ status: "no-data", findings: [] });
        expect(source.note).toContain("does not exist in DNS");
        expect(network.hosts()).toEqual(["cloudflare-dns.com"]);
    });

    it.each([
        ["no addresses", []],
        ["only private addresses", [{ type: A, data: "192.168.1.1" }]],
        ["only an alias", [{ type: CNAME, data: "elsewhere.example.net." }]],
    ])("explains a domain with %s", async (_name, answers) => {
        const { source } = await runWith([[dohRoute("example.com", "A"), doh(answers)]]);
        expect(source).toMatchObject({ status: "no-data", findings: [] });
        expect(source.note).toContain("no public IPv4 address");
    });

    it("reports no-data when none of the addresses is known to Shodan", async () => {
        const { source } = await runWith([
            [dohRoute("example.com", "A"), doh([{ type: A, data: "93.184.216.34" }])],
            ["https://internetdb.shodan.io/93.184.216.34", jsonReply({ detail: "No information available" }, 404)],
        ]);
        expect(source.status).toBe("no-data");
        expect(source.note).toContain("Checked the address example.com resolves to: 93.184.216.34.");
    });

    it("keeps the results it got when one address fails, and says so", async () => {
        const { source } = await runWith(
            routes([["https://internetdb.shodan.io/93.184.216.35", new Response("oops", { status: 503 })]]),
        );
        expect(source.status).toBe("ok");
        expect(source.findings.every((f) => f.id.includes("93.184.216.34"))).toBe(true);
        expect(source.note).toContain("1 of 2 lookups failed.");
    });

    it("reports the failure when every address lookup fails", async () => {
        const { source } = await runWith([
            [dohRoute("example.com", "A"), doh([{ type: A, data: "93.184.216.34" }])],
            [/internetdb\.shodan\.io/, new Response("slow down", { status: 429 })],
        ]);
        expect(source.status).toBe("rate-limited");
    });

    it("reports a failure to resolve the domain", async () => {
        const { source } = await runWith([[/.*/, new Response("down", { status: 500 })]]);
        expect(source.status).toBe("error");
    });
});
