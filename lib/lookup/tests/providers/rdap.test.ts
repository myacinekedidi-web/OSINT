import { describe, expect, it } from "vitest";
import { runProvider, type Provider } from "../../provider";
import { SourceResultSchema } from "../../report";
import { RdapDomainSchema, createRdapProvider, findRdapBase, isAllowedRdapBase, toFindings } from "../../providers/rdap";
import { fakeNetwork, json, type Route } from "../fake-network";

const NOW = new Date("2026-11-01T12:00:00.000Z");

/** Shaped like the file IANA publishes (RFC 9224), trimmed. */
const bootstrapFile = {
    version: "1.0",
    publication: "2026-10-30T12:00:00Z",
    description: "RDAP Bootstrap file for Domain Name System registrations",
    services: [
        [["com", "net"], ["https://rdap.verisign.com/com/v1/"]],
        [["org"], ["https://rdap.publicinterestregistry.org/rdap/"]],
        [["uk"], ["https://rdap.nominet.uk/uk/"]],
        [["co.uk"], ["https://rdap.example-registry.co.uk/co/"]], // multi-label entry: the longest match must win
        [["xyz"], ["http://insecure.example/", "https://rdap.centralnic.com/xyz/"]],
        [["bad"], ["http://only-http.example/"]],
    ],
};

/** Shaped like Verisign's answer for example.com. */
const exampleCom = {
    rdapConformance: ["rdap_level_0", "icann_rdap_technical_implementation_guide_0"],
    objectClassName: "domain",
    handle: "2336799_DOMAIN_COM-VRSN",
    ldhName: "EXAMPLE.COM",
    links: [{ rel: "related", href: "https://rdap.markmonitor.com/rdap/domain/EXAMPLE.COM" }],
    status: ["client delete prohibited", "client transfer prohibited", "client update prohibited"],
    entities: [
        {
            objectClassName: "entity",
            handle: "292",
            roles: ["registrar"],
            vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "MarkMonitor Inc."]]],
        },
        // Contacts must never be reported
        { objectClassName: "entity", roles: ["registrant"], vcardArray: ["vcard", [["fn", {}, "text", "Private Person"], ["email", {}, "text", "secret@example.net"]]] },
    ],
    events: [
        { eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" },
        { eventAction: "expiration", eventDate: "2027-08-13T04:00:00Z" },
        { eventAction: "last changed", eventDate: "2026-08-14T07:01:31Z" },
        { eventAction: "last update of RDAP database", eventDate: "2026-11-01T11:55:00Z" },
    ],
    secureDNS: { delegationSigned: true },
    nameservers: [
        { objectClassName: "nameserver", ldhName: "B.IANA-SERVERS.NET" },
        { objectClassName: "nameserver", ldhName: "A.IANA-SERVERS.NET" },
    ],
};

/** Runs the record through the real schema, exactly as the provider does. */
const parse = (value: unknown) => RdapDomainSchema.parse(value);

describe("isAllowedRdapBase", () => {
    it.each(["https://rdap.verisign.com/com/v1/", "https://rdap.nic.xyz/", "https://example.org:8443/rdap/"])("accepts %s", (url) => {
        expect(isAllowedRdapBase(url)).toBe(true);
    });

    it.each([
        "http://rdap.verisign.com/",
        "https://user:pw@rdap.example.com/",
        "https://127.0.0.1/rdap/",
        "https://169.254.169.254/",
        "https://[::1]/",
        "https://localhost/",
        "https://printer.local/",
        "https://rdap.internal/",
        "https://singlelabel/",
        "javascript:alert(1)",
        "not a url",
        "",
    ])("rejects %j", (url) => {
        expect(isAllowedRdapBase(url)).toBe(false);
    });
});

describe("findRdapBase", () => {
    const services = bootstrapFile.services.map(([tlds, urls]) => ({ tlds, urls }));

    it("finds the registry for a domain and adds the trailing slash", () => {
        expect(findRdapBase(services, "example.com")).toBe("https://rdap.verisign.com/com/v1/");
        expect(findRdapBase(services, "example.org")).toBe("https://rdap.publicinterestregistry.org/rdap/");
        expect(findRdapBase([{ tlds: ["io"], urls: ["https://rdap.nic.io"] }], "example.io")).toBe("https://rdap.nic.io/");
    });

    it("uses the longest matching suffix", () => {
        expect(findRdapBase(services, "example.co.uk")).toBe("https://rdap.example-registry.co.uk/co/");
        expect(findRdapBase(services, "example.org.uk")).toBe("https://rdap.nominet.uk/uk/");
    });

    it("skips servers that are not allowed and takes the next one", () => {
        expect(findRdapBase(services, "example.xyz")).toBe("https://rdap.centralnic.com/xyz/");
        expect(findRdapBase(services, "example.bad")).toBeNull();
    });

    it("does not match a different name that merely ends in the same letters", () => {
        expect(findRdapBase(services, "examplecom")).toBeNull();
        expect(findRdapBase(services, "notcom.invalid")).toBeNull();
    });

    it("is case-insensitive on the bootstrap side", () => {
        expect(findRdapBase([{ tlds: ["COM"], urls: ["https://rdap.verisign.com/com/v1/"] }], "example.com")).not.toBeNull();
    });

    it("returns null for a TLD without RDAP", () => {
        expect(findRdapBase(services, "example.zz")).toBeNull();
    });
});

describe("toFindings", () => {
    it("reports the registrar, dates, DNSSEC and name servers, and nothing about contacts", () => {
        const findings = toFindings(parse(exampleCom), NOW);
        const registration = findings.find((f) => f.id === "rdap:registration")!;

        expect(registration.data).toEqual({
            registrar: ["MarkMonitor Inc."],
            registered: ["1995-08-14"],
            expires: ["2027-08-13"],
            updated: ["2026-08-14"],
            dnssec: ["signed"],
            nameservers: ["a.iana-servers.net", "b.iana-servers.net"],
        });
        expect(JSON.stringify(findings)).not.toContain("Private Person");
        expect(JSON.stringify(findings)).not.toContain("secret@example.net");
    });

    it("reports routine statuses as info", () => {
        const status = toFindings(parse({ ...exampleCom, status: ["client transfer prohibited"] }), NOW).find((f) => f.id === "rdap:status")!;
        expect(status.severity).toBe("info");
        expect(status.title).toBe("Status (1)");
    });

    it.each(["server hold", "clientHold", "pending delete", "redemption period", "Redemption-Period"])(
        "flags the status %j",
        (statusValue) => {
            const status = toFindings(parse({ ...exampleCom, status: ["client transfer prohibited", statusValue] }), NOW).find((f) => f.id === "rdap:status")!;
            expect(status.severity).toBe("medium");
            expect(status.title).toBe("Domain is suspended or being deleted");
        },
    );

    describe("recently registered domains", () => {
        const registeredDaysAgo = (days: number) =>
            parse({ ...exampleCom, events: [{ eventAction: "registration", eventDate: new Date(NOW.getTime() - days * 86_400_000).toISOString() }] });

        it.each([[0, "today"], [1, "1 day ago"], [12, "12 days ago"], [29, "29 days ago"]])("flags %i days", (days, label) => {
            const finding = toFindings(registeredDaysAgo(days), NOW).find((f) => f.id === "rdap:recent")!;
            expect(finding.title).toBe(`Registered recently (${label})`);
            expect(finding.severity).toBe("low");
            expect(finding.detail).toContain("not a verdict");
        });

        it.each([30, 90, 4000])("does not flag %i days", (days) => {
            expect(toFindings(registeredDaysAgo(days), NOW).find((f) => f.id === "rdap:recent")).toBeUndefined();
        });

        it("ignores a registration date in the future or an unreadable one", () => {
            expect(toFindings(registeredDaysAgo(-5), NOW).find((f) => f.id === "rdap:recent")).toBeUndefined();
            const garbage = parse({ events: [{ eventAction: "registration", eventDate: "yesterday-ish" }] });
            expect(toFindings(garbage, NOW)).toEqual([]);
        });
    });

    it("survives a record with almost nothing in it", () => {
        expect(toFindings(parse({ status: [], events: [], nameservers: [], entities: [] }), NOW)).toEqual([]);
    });

    it.each([
        ["no vcard", { roles: ["registrar"] }],
        ["a vcard that is not a list", { roles: ["registrar"], vcardArray: "nope" }],
        ["a vcard without a name", { roles: ["registrar"], vcardArray: ["vcard", [["version", {}, "text", "4.0"]]] }],
        ["a name that is not text", { roles: ["registrar"], vcardArray: ["vcard", [["fn", {}, "text", 5]]] }],
    ])("copes with a registrar entity with %s", (_name, entity) => {
        const findings = toFindings(parse({ ...exampleCom, entities: [entity] }), NOW);
        expect((findings.find((f) => f.id === "rdap:registration")!.data as Record<string, unknown>).registrar).toBeUndefined();
    });
});

/** The fake network for a domain lookup: bootstrap file plus the registry's answer. */
const registryRoutes = (extra: Route[] = []): Route[] => [
    ...extra,
    ["https://data.iana.org/rdap/dns.json", json(bootstrapFile)],
    [/rdap\.verisign\.com\/com\/v1\/domain\/EXAMPLE|rdap\.verisign\.com\/com\/v1\/domain\/example\.com/, json(exampleCom)],
];

const runOn = (provider: Provider, routes: Route[], input: Parameters<typeof runProvider>[1] = { kind: "domain", value: "example.com" }, now = () => NOW) => {
    const network = fakeNetwork(routes);
    return runProvider(provider, input, { fetch: network.fetch, now }).then((source) => ({ source, network }));
};

describe("rdap provider", () => {
    it("fetches the bootstrap, asks the registry directly, and reports the registration", async () => {
        const { source, network } = await runOn(createRdapProvider(), registryRoutes());

        expect(source.status).toBe("ok");
        expect(source.findings.map((f) => f.id)).toEqual(["rdap:registration", "rdap:status"]);
        expect(SourceResultSchema.safeParse(source).success).toBe(true);
        expect(network.urls).toEqual([
            "https://data.iana.org/rdap/dns.json",
            "https://rdap.verisign.com/com/v1/domain/example.com",
        ]);
        expect(network.hosts()).toEqual(["data.iana.org", "rdap.verisign.com"]);
        expect((network.requests[1].init.headers as Record<string, string>).accept).toContain("application/rdap+json");
        expect(network.requests[1].init.redirect).toBe("error"); // never follows redirects to a registry
    });

    it("supports domains, but not IPs, and explains a public suffix", () => {
        const provider = createRdapProvider();
        expect(provider.supports({ kind: "domain", value: "example.com" })).toBe(true);
        expect(provider.supports({ kind: "email", value: "a@example.com", domain: "example.com" })).toBe(true);
        expect(provider.supports({ kind: "ipv4", value: "8.8.8.8" })).toBe(false);
        expect(provider.unsupportedNote?.({ kind: "ipv4", value: "8.8.8.8" })).toBeUndefined();

        expect(provider.supports({ kind: "domain", value: "co.uk" })).toBe(false);
        expect(provider.unsupportedNote?.({ kind: "domain", value: "co.uk" })).toContain("public suffix");
    });

    it("looks up the registered domain for a subdomain, and says so", async () => {
        const { source, network } = await runOn(createRdapProvider(), registryRoutes(), { kind: "domain", value: "www.example.com" });
        expect(network.urls[1]).toBe("https://rdap.verisign.com/com/v1/domain/example.com");
        expect(source.note).toBe("Registration data is for the registered domain example.com.");
    });

    it("says which part of an email or URL was used", async () => {
        const email = await runOn(createRdapProvider(), registryRoutes(), { kind: "email", value: "a@example.com", domain: "example.com" });
        expect(email.source.note).toContain("domain part of the address");
        const url = await runOn(createRdapProvider(), registryRoutes(), { kind: "url", value: "https://example.com/x", hostname: "example.com" });
        expect(url.source.note).toContain("host of the URL");
    });

    describe("the bootstrap cache", () => {
        it("downloads the bootstrap once for many lookups", async () => {
            const provider = createRdapProvider();
            const network = fakeNetwork(registryRoutes());
            const options = { fetch: network.fetch, now: () => NOW };
            await runProvider(provider, { kind: "domain", value: "example.com" }, options);
            await runProvider(provider, { kind: "domain", value: "example.com" }, options);
            await runProvider(provider, { kind: "domain", value: "example.com" }, options);

            expect(network.urls.filter((u) => u.includes("data.iana.org"))).toHaveLength(1);
            expect(network.urls.filter((u) => u.includes("rdap.verisign.com"))).toHaveLength(3);
        });

        it("shares one download between lookups that start together", async () => {
            const provider = createRdapProvider();
            const network = fakeNetwork(registryRoutes());
            const options = { fetch: network.fetch, now: () => NOW };
            await Promise.all(
                Array.from({ length: 5 }, () => runProvider(provider, { kind: "domain", value: "example.com" }, options)),
            );
            expect(network.urls.filter((u) => u.includes("data.iana.org"))).toHaveLength(1);
        });

        it("downloads it again after the time to live", async () => {
            const provider = createRdapProvider({ ttlMs: 60_000 });
            const network = fakeNetwork(registryRoutes());
            let clock = NOW.getTime();
            const options = { fetch: network.fetch, now: () => new Date(clock) };

            await runProvider(provider, { kind: "domain", value: "example.com" }, options);
            clock += 59_000;
            await runProvider(provider, { kind: "domain", value: "example.com" }, options);
            expect(network.urls.filter((u) => u.includes("data.iana.org"))).toHaveLength(1);

            clock += 2_000;
            await runProvider(provider, { kind: "domain", value: "example.com" }, options);
            expect(network.urls.filter((u) => u.includes("data.iana.org"))).toHaveLength(2);
        });

        it("keeps separate caches per provider instance", async () => {
            const network = fakeNetwork(registryRoutes());
            const options = { fetch: network.fetch, now: () => NOW };
            await runProvider(createRdapProvider(), { kind: "domain", value: "example.com" }, options);
            await runProvider(createRdapProvider(), { kind: "domain", value: "example.com" }, options);
            expect(network.urls.filter((u) => u.includes("data.iana.org"))).toHaveLength(2);
        });
    });

    describe("falling back to rdap.org", () => {
        const fallbackRoutes = (bootstrapReply: Route[1]): Route[] => [
            ["https://data.iana.org/rdap/dns.json", bootstrapReply],
            ["https://rdap.org/domain/example.com", json(exampleCom)],
        ];

        it.each([
            ["is down", () => new Response("bad gateway", { status: 502 })],
            ["is not JSON", () => new Response("<html>", { status: 200 })],
            ["has an unexpected shape", () => json({ services: "nope" })],
            ["cannot be reached", () => new TypeError("fetch failed")],
        ])("when the bootstrap file %s", async (_name, reply) => {
            const { source, network } = await runOn(createRdapProvider(), fallbackRoutes(reply));
            expect(source.status).toBe("ok");
            expect(network.urls.at(-1)).toBe("https://rdap.org/domain/example.com");
            expect(network.requests.at(-1)!.init.redirect).toBe("follow"); // rdap.org answers with a redirect
        });
    });

    it("reports a TLD whose registry publishes no RDAP", async () => {
        const { source, network } = await runOn(createRdapProvider(), registryRoutes(), { kind: "domain", value: "example.zz" });
        expect(source).toMatchObject({ status: "no-data", findings: [] });
        expect(source.note).toBe("The registry for .zz does not publish RDAP data.");
        expect(network.urls).toEqual(["https://data.iana.org/rdap/dns.json"]);
    });

    it("reports a domain the registry does not know", async () => {
        const { source } = await runOn(
            createRdapProvider(),
            [["https://data.iana.org/rdap/dns.json", json(bootstrapFile)], [/rdap\.verisign\.com/, json({ errorCode: 404, title: "Not Found" }, 404)]],
            { kind: "domain", value: "unregistered-example.com" },
        );
        expect(source).toMatchObject({ status: "no-data", findings: [] });
        expect(source.note).toContain("may not be registered");
    });

    it("maps registry failures", async () => {
        const bootstrap: Route = ["https://data.iana.org/rdap/dns.json", json(bootstrapFile)];
        const limited = await runOn(createRdapProvider(), [bootstrap, [/rdap\.verisign\.com/, new Response("slow down", { status: 429, headers: { "retry-after": "5" } })]]);
        expect(limited.source.status).toBe("rate-limited");

        const broken = await runOn(createRdapProvider(), [bootstrap, [/rdap\.verisign\.com/, new Response("oops", { status: 503 })]]);
        expect(broken.source.status).toBe("error");

        const malformed = await runOn(createRdapProvider(), [bootstrap, [/rdap\.verisign\.com/, json({ status: "not a list" })]]);
        expect(malformed.source.status).toBe("error");
        expect(malformed.source.note).toContain("unexpected format");
    });

    it("never contacts a host that is not the bootstrap, a registry named in it, or rdap.org", async () => {
        const hostile = {
            ...bootstrapFile,
            services: [[["com"], ["https://169.254.169.254/latest/", "http://evil.example/", "https://127.0.0.1/"]]],
        };
        const { source, network } = await runOn(createRdapProvider(), [
            ["https://data.iana.org/rdap/dns.json", json(hostile)],
        ]);
        // Every listed server is refused, so the TLD counts as having no usable RDAP service
        expect(source.status).toBe("no-data");
        expect(network.hosts()).toEqual(["data.iana.org"]);
    });
});
