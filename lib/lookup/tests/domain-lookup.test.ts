import { describe, expect, it } from "vitest";
import { LookupResponseSchema } from "../api";
import { handleLookup } from "../handler";
import { runLookup } from "../lookup";
import { crtsh } from "../providers/crtsh";
import { dns } from "../providers/dns";
import { internetDb } from "../providers/internetdb";
import { createRdapProvider } from "../providers/rdap";
import { PROVIDERS } from "../registry";
import { A, AAAA, MX, NS, TXT, doh, dohRoute, fakeNetwork, json, type Route } from "./fake-network";

const NOW = () => new Date("2026-11-01T12:00:00.000Z");

/** Every host a lookup may ever contact. Anything else is a bug (or an attack). */
const ALLOWED_HOSTS = ["data.iana.org", "rdap.verisign.com", "cloudflare-dns.com", "internetdb.shodan.io", "crt.sh"];

const example: Route[] = [
    ["https://data.iana.org/rdap/dns.json", json({ version: "1.0", services: [[["com"], ["https://rdap.verisign.com/com/v1/"]]] })],
    [
        "https://rdap.verisign.com/com/v1/domain/example.com",
        json({
            objectClassName: "domain",
            status: ["client transfer prohibited"],
            entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["fn", {}, "text", "MarkMonitor Inc."]]] }],
            events: [{ eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" }],
            nameservers: [{ ldhName: "A.IANA-SERVERS.NET" }],
        }),
    ],
    [dohRoute("example.com", "A"), doh([{ type: A, data: "93.184.216.34" }])],
    [dohRoute("example.com", "AAAA"), doh([{ type: AAAA, data: "2606:2800:220:1:248:1893:25c8:1946" }])],
    [dohRoute("example.com", "NS"), doh([{ type: NS, data: "a.iana-servers.net." }])],
    [dohRoute("example.com", "MX"), doh([{ type: MX, data: "0 ." }])],
    [dohRoute("example.com", "TXT"), doh([{ type: TXT, data: '"v=spf1 -all"' }])],
    [dohRoute("_dmarc.example.com", "TXT"), doh([{ type: TXT, data: '"v=DMARC1;p=reject"' }])],
    ["https://internetdb.shodan.io/93.184.216.34", json({ ip: "93.184.216.34", ports: [80, 443], cpes: [], hostnames: [], tags: ["cdn"], vulns: [] })],
    [
        /^https:\/\/crt\.sh\//,
        json([{ id: 1, issuer_name: "C=US, O=DigiCert Inc, CN=DigiCert", common_name: "www.example.com", name_value: "example.com\nwww.example.com", not_before: "2026-01-01T00:00:00" }]),
    ],
];

describe("a full domain lookup", () => {
    it("asks four sources in parallel and assembles one report", async () => {
        const network = fakeNetwork(example);
        const report = await runLookup(
            { kind: "domain", value: "example.com" },
            { providers: [createRdapProvider(), dns, internetDb, crtsh], fetch: network.fetch, now: NOW },
        );

        expect(report.sources.map((s) => [s.source, s.status])).toEqual([
            ["rdap", "ok"],
            ["dns", "ok"],
            ["internetdb", "ok"],
            ["crtsh", "ok"],
        ]);
        const ids = report.sources.flatMap((s) => s.findings.map((f) => f.id));
        expect(ids).toContain("rdap:registration");
        expect(ids).toContain("dns:email-auth");
        expect(ids).toContain("internetdb:93.184.216.34:ports");
        expect(ids).toContain("crtsh:subdomains");
    });

    it("contacts only the hosts it is supposed to", async () => {
        const network = fakeNetwork(example);
        await runLookup({ kind: "domain", value: "example.com" }, { providers: [createRdapProvider(), dns, internetDb, crtsh], fetch: network.fetch, now: NOW });
        expect(network.hosts().sort()).toEqual([...ALLOWED_HOSTS].sort());
        expect(network.hosts().every((host) => ALLOWED_HOSTS.includes(host))).toBe(true);
    });

    it("never sends the user's input anywhere it should not go", async () => {
        const network = fakeNetwork([
            ...example,
            [dohRoute("example.com", "A"), doh([{ type: A, data: "93.184.216.34" }])],
        ]);
        await runLookup(
            { kind: "url", value: "https://example.com/reset?token=SECRET123&email=alice@example.com", hostname: "example.com" },
            { providers: [createRdapProvider(), dns, internetDb, crtsh], fetch: network.fetch, now: NOW },
        );
        // Only the host leaves; the path and query string (which can hold tokens or emails) never do
        expect(network.urls.join("\n")).not.toContain("SECRET123");
        expect(network.urls.join("\n")).not.toContain("alice");
        expect(network.urls.join("\n")).not.toContain("/reset");
    });

    it("keeps the report useful when some sources fail", async () => {
        const network = fakeNetwork([
            [/crt\.sh/, new Response("<html>502</html>", { status: 502 })],
            [/internetdb/, new Response("slow down", { status: 429 })],
            ...example,
        ]);
        const report = await runLookup({ kind: "domain", value: "example.com" }, { providers: [createRdapProvider(), dns, internetDb, crtsh], fetch: network.fetch, now: NOW });
        expect(report.sources.map((s) => [s.source, s.status])).toEqual([
            ["rdap", "ok"],
            ["dns", "ok"],
            ["internetdb", "rate-limited"],
            ["crtsh", "error"],
        ]);
    });

    it("makes a bounded number of requests", async () => {
        const network = fakeNetwork(example);
        await runLookup({ kind: "domain", value: "example.com" }, { providers: [createRdapProvider(), dns, internetDb, crtsh], fetch: network.fetch, now: NOW });
        // bootstrap + registry (2), 6 DNS records, 1 A + 1 per address for Shodan (2), crt.sh (1)
        expect(network.urls).toHaveLength(2 + 6 + 2 + 1);
    });
});

describe("through the HTTP handler", () => {
    const post = (input: string) =>
        new Request("https://app.test/api/lookup", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ input }),
        });

    it("returns a valid report for an email address using only its domain", async () => {
        const network = fakeNetwork(example);
        const response = await handleLookup(post("Alice@Example.com"), { providers: PROVIDERS, fetch: network.fetch, now: NOW, log: () => {} });
        const body = LookupResponseSchema.parse(await response.json());

        expect(response.status).toBe(200);
        expect(body.report.input).toEqual({ kind: "email", value: "Alice@example.com" });
        expect(body.report.sources.map((s) => s.source)).toEqual(["rdap", "dns"]);
        // The local part of the address is never sent to any service
        expect(network.urls.join("\n").toLowerCase()).not.toContain("alice");
    });

    it("returns a valid report for a domain", async () => {
        const network = fakeNetwork(example);
        const response = await handleLookup(post("example.com"), { providers: PROVIDERS, fetch: network.fetch, now: NOW, log: () => {} });
        const body = LookupResponseSchema.parse(await response.json());
        expect(body.report.sources.map((s) => s.source)).toEqual(["rdap", "dns", "internetdb", "crtsh"]);
        expect(network.hosts().every((host) => ALLOWED_HOSTS.includes(host))).toBe(true);
    });
});
