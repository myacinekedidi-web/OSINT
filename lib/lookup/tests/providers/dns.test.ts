import { describe, expect, it } from "vitest";
import { runProvider } from "../../provider";
import { dns, toFindings } from "../../providers/dns";
import { SourceResultSchema } from "../../report";
import { A, AAAA, CNAME, MX, NS, TXT, doh, dohRoute, fakeNetwork, type Route } from "../fake-network";

const NOW = () => new Date("2026-11-01T12:00:00.000Z");

const result = (answers: { type: number; data: string }[], rcode = 0) => ({ rcode, answers });
const byId = (findings: ReturnType<typeof toFindings>) => Object.fromEntries(findings.map((f) => [f.id, f]));

describe("toFindings", () => {
    it("lists addresses, sorted and de-duplicated, with any CNAME", () => {
        const f = byId(
            toFindings({
                a: result([
                    { type: CNAME, data: "Edge.Example.net." },
                    { type: A, data: "93.184.216.35" },
                    { type: A, data: "93.184.216.34" },
                    { type: A, data: "93.184.216.34" },
                ]),
                aaaa: result([{ type: AAAA, data: "2606:2800:220:1:248:1893:25C8:1946" }]),
            }),
        );
        expect(f["dns:addresses"].title).toBe("Addresses (3)");
        expect(f["dns:addresses"].data).toEqual({
            cname: ["edge.example.net"],
            ipv4: ["93.184.216.34", "93.184.216.35"],
            ipv6: ["2606:2800:220:1:248:1893:25c8:1946"],
        });
    });

    it("lists name servers without trailing dots", () => {
        const f = byId(toFindings({ ns: result([{ type: NS, data: "B.IANA-SERVERS.NET." }, { type: NS, data: "a.iana-servers.net." }]) }));
        expect(f["dns:ns"].data).toEqual({ nameservers: ["a.iana-servers.net", "b.iana-servers.net"] });
    });

    it("orders mail servers by preference", () => {
        const f = byId(
            toFindings({ mx: result([{ type: MX, data: "20 alt.example.com." }, { type: MX, data: "10 mail.example.com." }]) }),
        );
        expect(f["dns:mx"].title).toBe("Mail servers (2)");
        expect(f["dns:mx"].data).toEqual({ mx: ["10 mail.example.com", "20 alt.example.com"] });
    });

    it("recognizes a null MX (RFC 7505)", () => {
        const f = byId(toFindings({ mx: result([{ type: MX, data: "0 ." }]) }));
        expect(f["dns:mx"].title).toBe("Does not accept email (null MX)");
        expect(f["dns:mx"].data).toBeUndefined();
    });

    describe("email authentication", () => {
        const mail = result([{ type: MX, data: "10 mail.example.com." }]);
        const spf = result([{ type: TXT, data: '"v=spf1 include:_spf.example.com -all"' }]);
        const dmarc = result([{ type: TXT, data: '"v=DMARC1; p=reject; rua=mailto:d@example.com"' }]);
        const none = result([]);

        it("is info when both are published", () => {
            const f = byId(toFindings({ mx: mail, txt: spf, dmarc }));
            expect(f["dns:email-auth"].title).toBe("Email authentication: SPF found, DMARC found");
            expect(f["dns:email-auth"].severity).toBe("info");
            expect(f["dns:email-auth"].data).toEqual({
                spf: ["v=spf1 include:_spf.example.com -all"],
                dmarc: ["v=DMARC1; p=reject; rua=mailto:d@example.com"],
            });
        });

        it("is low when a domain that receives mail lacks one of them", () => {
            expect(byId(toFindings({ mx: mail, txt: spf, dmarc: none }))["dns:email-auth"]).toMatchObject({
                title: "Email authentication: SPF found, DMARC missing",
                severity: "low",
            });
            expect(byId(toFindings({ mx: mail, txt: none, dmarc }))["dns:email-auth"]).toMatchObject({
                title: "Email authentication: SPF missing, DMARC found",
                severity: "low",
            });
            expect(byId(toFindings({ mx: mail, txt: none, dmarc: none }))["dns:email-auth"].severity).toBe("low");
        });

        it("is only info for a domain that does not receive mail", () => {
            const f = byId(toFindings({ mx: none, txt: none, dmarc: none }));
            expect(f["dns:email-auth"].severity).toBe("info");
            expect(f["dns:email-auth"].data).toBeUndefined();
        });

        it("is skipped when the TXT records were not fetched", () => {
            expect(byId(toFindings({ mx: mail }))["dns:email-auth"]).toBeUndefined();
        });

        it("ignores look-alike records", () => {
            const f = byId(toFindings({ mx: mail, txt: result([{ type: TXT, data: '"not v=spf1 really"' }]), dmarc: result([{ type: TXT, data: '"v=DMARC2"' }]) }));
            expect(f["dns:email-auth"].title).toBe("Email authentication: SPF missing, DMARC missing");
        });
    });

    it("lists other TXT records, capped and trimmed, without the SPF record", () => {
        const many = Array.from({ length: 25 }, (_, i) => ({ type: TXT, data: `"token-${String(i).padStart(2, "0")}"` }));
        const f = byId(toFindings({ txt: result([...many, { type: TXT, data: '"v=spf1 -all"' }, { type: TXT, data: `"${"x".repeat(400)}"` }]) }));
        const shown = (f["dns:txt"].data as { txt: string[] }).txt;
        expect(f["dns:txt"].title).toBe("TXT records (26)");
        expect(shown).toHaveLength(20);
        expect(shown.every((t) => t.length <= 301)).toBe(true);
        expect(shown.some((t) => t.startsWith("v=spf1"))).toBe(false);
    });

    it("produces nothing from empty answers", () => {
        expect(toFindings({ a: result([]), ns: result([]), mx: result([]) })).toEqual([]);
        expect(toFindings({})).toEqual([]);
    });
});

/** A complete, realistic set of answers for example.com. */
function exampleDomain(overrides: Route[] = []): Route[] {
    return [
        ...overrides,
        [dohRoute("example.com", "A"), doh([{ type: A, data: "93.184.216.34" }])],
        [dohRoute("example.com", "AAAA"), doh([{ type: AAAA, data: "2606:2800:220:1:248:1893:25c8:1946" }])],
        [dohRoute("example.com", "NS"), doh([{ type: NS, data: "a.iana-servers.net." }, { type: NS, data: "b.iana-servers.net." }])],
        [dohRoute("example.com", "MX"), doh([{ type: MX, data: "0 ." }])],
        [dohRoute("example.com", "TXT"), doh([{ type: TXT, data: '"v=spf1 -all"' }, { type: TXT, data: '"wgyf8z8cgvm2qmxpnbnldrcltvk4xqfn"' }])],
        [dohRoute("_dmarc.example.com", "TXT"), doh([{ type: TXT, data: '"v=DMARC1;p=reject;sp=reject;adkim=s;aspf=s"' }])],
    ];
}

const run = (routes: Route[], input: Parameters<typeof runProvider>[1], timeoutMs?: number) => {
    const network = fakeNetwork(routes);
    return runProvider(dns, input, { fetch: network.fetch, now: NOW, timeoutMs }).then((source) => ({ source, network }));
};

describe("dns provider", () => {
    it("reports everything for a domain", async () => {
        const { source, network } = await run(exampleDomain(), { kind: "domain", value: "example.com" });

        expect(source.status).toBe("ok");
        expect(source.findings.map((f) => f.id)).toEqual(["dns:addresses", "dns:ns", "dns:mx", "dns:email-auth", "dns:txt"]);
        expect(SourceResultSchema.safeParse(source).success).toBe(true);
        expect(network.hosts()).toEqual(["cloudflare-dns.com"]);
        expect(network.urls).toHaveLength(6);
        expect(source.note).toBeUndefined();
    });

    it("applies to domains, URLs with a domain host and emails, but not to IP addresses", () => {
        expect(dns.supports({ kind: "domain", value: "example.com" })).toBe(true);
        expect(dns.supports({ kind: "url", value: "https://example.com/", hostname: "example.com" })).toBe(true);
        expect(dns.supports({ kind: "email", value: "a@example.com", domain: "example.com" })).toBe(true);
        expect(dns.supports({ kind: "ipv4", value: "8.8.8.8" })).toBe(false);
        expect(dns.supports({ kind: "url", value: "http://8.8.8.8/", hostname: "8.8.8.8" })).toBe(false);
    });

    it("asks address records for the host and zone records for the registered domain", async () => {
        const { network } = await run(
            [
                [dohRoute("www.example.com", "A"), doh([{ type: CNAME, data: "example.com." }, { type: A, data: "93.184.216.34" }])],
                [dohRoute("www.example.com", "AAAA"), doh()],
                [dohRoute("example.com", "NS"), doh([{ type: NS, data: "a.iana-servers.net." }])],
                [dohRoute("example.com", "MX"), doh()],
                [dohRoute("example.com", "TXT"), doh()],
                [dohRoute("_dmarc.example.com", "TXT"), doh()],
            ],
            { kind: "domain", value: "www.example.com" },
        );
        expect(network.urls.map((u) => u.split("?")[1])).toEqual([
            "name=www.example.com&type=A",
            "name=www.example.com&type=AAAA",
            "name=example.com&type=NS",
            "name=example.com&type=MX",
            "name=example.com&type=TXT",
            "name=_dmarc.example.com&type=TXT",
        ]);
    });

    it("only asks for mail-related records for an email address, and says which domain it used", async () => {
        const { source, network } = await run(exampleDomain(), { kind: "email", value: "a@example.com", domain: "example.com" });

        expect(network.urls.map((u) => u.split("?")[1])).toEqual([
            "name=example.com&type=NS",
            "name=example.com&type=MX",
            "name=example.com&type=TXT",
            "name=_dmarc.example.com&type=TXT",
        ]);
        expect(source.findings.map((f) => f.id)).not.toContain("dns:addresses");
        expect(source.note).toContain("domain part of the address: example.com");
    });

    it("says so when a URL's host was used", async () => {
        const { source } = await run(exampleDomain(), { kind: "url", value: "https://example.com/login", hostname: "example.com" });
        expect(source.note).toContain("host of the URL");
    });

    it("explains a domain that does not exist", async () => {
        const nx = (name: string, type: string): Route => [dohRoute(name, type), doh([], 3)];
        const { source } = await run(
            [nx("nope.example.org", "A"), nx("nope.example.org", "AAAA"), nx("example.org", "NS"), nx("example.org", "MX"), nx("example.org", "TXT"), nx("_dmarc.example.org", "TXT")],
            { kind: "domain", value: "nope.example.org" },
        );
        expect(source).toMatchObject({ status: "no-data", findings: [] });
        expect(source.note).toContain("does not exist in DNS (NXDOMAIN)");
    });

    it("reports a resolver failure for the domain as an error", async () => {
        const sf = (name: string, type: string): Route => [dohRoute(name, type), doh([], 2)];
        const { source } = await run(
            [sf("broken.example.com", "A"), sf("broken.example.com", "AAAA"), sf("example.com", "NS"), sf("example.com", "MX"), sf("example.com", "TXT"), sf("_dmarc.example.com", "TXT")],
            { kind: "domain", value: "broken.example.com" },
        );
        expect(source.status).toBe("error");
        expect(source.note).toContain("SERVFAIL");
    });

    it("keeps the records it got and names the types that failed", async () => {
        const { source } = await run(
            exampleDomain([[dohRoute("example.com", "MX"), new Response("x", { status: 500 })], [/dns\.google.*type=MX/, new Response("x", { status: 500 })]]),
            { kind: "domain", value: "example.com" },
        );
        expect(source.status).toBe("ok");
        expect(source.findings.map((f) => f.id)).not.toContain("dns:mx");
        expect(source.note).toBe("Some record types could not be fetched: MX.");
    });

    it("reports the failure when nothing could be fetched", async () => {
        const { source } = await run([[/.*/, new Response("slow down", { status: 429 })]], { kind: "domain", value: "example.com" });
        expect(source.status).toBe("rate-limited");
    });

    it("reports no-data for a real domain without any of the checked records", async () => {
        const empty = (name: string, type: string): Route => [dohRoute(name, type), doh()];
        const { source } = await run(
            [empty("quiet.example.com", "A"), empty("quiet.example.com", "AAAA"), empty("example.com", "NS"), empty("example.com", "MX"), empty("example.com", "TXT"), empty("_dmarc.example.com", "TXT")],
            { kind: "domain", value: "quiet.example.com" },
        );
        // No A/NS/MX/TXT answers, but the email-authentication check still reports "missing"
        expect(source.status).toBe("ok");
        expect(source.findings.map((f) => f.id)).toEqual(["dns:email-auth"]);
    });

    it("times out cleanly", async () => {
        const { source } = await run([[/.*/, () => new Promise<Response>(() => {})]], { kind: "domain", value: "example.com" }, 30);
        expect(source.status).toBe("timeout");
    });
});
