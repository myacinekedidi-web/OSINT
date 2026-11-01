import { describe, expect, it } from "vitest";
import { detectInput, INPUT_KIND_LABEL, type LookupInput, type RejectReason } from "../detect-input";

function accepted(raw: string): LookupInput {
    const result = detectInput(raw);
    if (!result.ok) throw new Error(`expected ${JSON.stringify(raw)} to be accepted, got ${result.reason}`);
    return result.input;
}

function rejectedWith(raw: string): RejectReason {
    const result = detectInput(raw);
    if (result.ok) throw new Error(`expected ${JSON.stringify(raw)} to be rejected, got ${JSON.stringify(result.input)}`);
    return result.reason;
}

describe("IP addresses", () => {
    it("detects a public IPv4 address", () => {
        expect(accepted("8.8.8.8")).toEqual({ kind: "ipv4", value: "8.8.8.8" });
    });

    it("trims surrounding whitespace", () => {
        expect(accepted("  8.8.8.8\n")).toEqual({ kind: "ipv4", value: "8.8.8.8" });
    });

    it.each([
        ["2606:4700:4700::1111", "2606:4700:4700::1111"],
        ["2606:4700:4700:0:0:0:0:1111", "2606:4700:4700::1111"],
        ["[2606:4700:4700::1111]", "2606:4700:4700::1111"],
        ["2606:4700:4700::1111".toUpperCase(), "2606:4700:4700::1111"],
    ])("detects and canonicalizes IPv6 %s", (raw, value) => {
        expect(accepted(raw)).toEqual({ kind: "ipv6", value });
    });

    it.each(["10.0.0.1", "127.0.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fc00::1", "2001:db8::1", "::ffff:8.8.8.8"])(
        "rejects the non-public address %s",
        (raw) => expect(rejectedWith(raw)).toBe("non_public_ip"),
    );

    it.each(["2130706433", "0x7f.0.0.1", "127.1", "01.2.3.4", "999.1.1.1", "1.2.3"])(
        "does not accept the obfuscated or malformed address %s",
        (raw) => {
            // Never classified as an IP; either a bad domain or unrecognized
            expect(["invalid_domain", "unrecognized"]).toContain(rejectedWith(raw));
        },
    );
});

describe("domains", () => {
    it("detects a bare domain", () => {
        expect(accepted("example.com")).toEqual({ kind: "domain", value: "example.com" });
    });

    it.each([
        ["EXAMPLE.COM", "example.com"],
        ["Example.Com.", "example.com"], // trailing dot
        ["sub.domain.example.co.uk", "sub.domain.example.co.uk"],
        ["münchen.de", "xn--mnchen-3ya.de"], // IDN -> punycode
        ["xn--mnchen-3ya.de", "xn--mnchen-3ya.de"],
        ["a-b.example.io", "a-b.example.io"],
        ["1password.com", "1password.com"],
    ])("normalizes %s", (raw, value) => {
        expect(accepted(raw)).toEqual({ kind: "domain", value });
    });

    it.each(["localhost", "printer.local", "db.internal", "foo.localhost", "site.test", "thing.invalid", "x.onion", "host.lan", "1.0.0.127.in-addr.arpa"])(
        "rejects the reserved name %s",
        (raw) => expect(rejectedWith(raw)).toBe("reserved_domain"),
    );

    it.each([
        "-bad.example.com",
        "bad-.example.com",
        "exa_mple.com",
        "example..com",
        ".example.com",
        "example.c", // TLD too short
        "example.123", // numeric TLD
        "*.example.com",
        "example.com:8080",
    ])("rejects the malformed domain %j", (raw) => {
        expect(["invalid_domain", "unrecognized"]).toContain(rejectedWith(raw));
    });

    it("rejects a label over 63 characters", () => {
        expect(rejectedWith(`${"a".repeat(64)}.com`)).toBe("invalid_domain");
    });

    it("rejects a name over 253 characters", () => {
        expect(rejectedWith(`${"a.".repeat(130)}com`)).toBe("invalid_domain");
    });

    it.each(["hello", "javascript:alert(1)", "com"])("does not recognize %j", (raw) => {
        expect(rejectedWith(raw)).toBe("unrecognized");
    });

    it("rejects input containing whitespace or control characters", () => {
        expect(rejectedWith("exa mple.com")).toBe("unrecognized");
        expect(rejectedWith("example.com\nother.com")).toBe("unrecognized");
        expect(rejectedWith("example.com\u0000")).toBe("unrecognized");
    });
});

describe("URLs", () => {
    it("detects an https URL and exposes its hostname", () => {
        expect(accepted("https://Example.com/path?q=1")).toEqual({
            kind: "url",
            value: "https://example.com/path?q=1",
            hostname: "example.com",
        });
    });

    it("accepts http as well", () => {
        expect(accepted("http://example.com")).toMatchObject({ kind: "url", hostname: "example.com" });
    });

    it("drops the fragment but keeps path, query and port", () => {
        expect(accepted("https://example.com:8443/a/b?x=1#frag")).toMatchObject({
            value: "https://example.com:8443/a/b?x=1",
        });
    });

    it("converts an IDN host to punycode", () => {
        expect(accepted("https://münchen.de/")).toMatchObject({ hostname: "xn--mnchen-3ya.de" });
    });

    it("accepts a public IP literal as the host", () => {
        expect(accepted("http://8.8.8.8/dns")).toMatchObject({ kind: "url", hostname: "8.8.8.8" });
        expect(accepted("https://[2606:4700:4700::1111]/")).toMatchObject({ kind: "url", hostname: "2606:4700:4700::1111" });
    });

    it("assumes https for a URL without a scheme, and says so", () => {
        const result = detectInput("example.com/login.php?next=/");
        expect(result).toMatchObject({
            ok: true,
            input: { kind: "url", value: "https://example.com/login.php?next=/", hostname: "example.com" },
        });
        expect(result.ok && result.notice).toContain("https");
    });

    it("does not add a notice when the scheme was given", () => {
        const result = detectInput("https://example.com");
        expect(result.ok && result.notice).toBeFalsy();
    });

    it.each(["ftp://example.com", "file:///etc/passwd", "javascript://example.com/%0aalert(1)", "data://text/plain,hi", "gopher://example.com"])(
        "rejects the scheme in %s",
        (raw) => expect(rejectedWith(raw)).toBe("unsupported_url_scheme"),
    );

    it.each(["https://user:pass@example.com/", "https://user@example.com/", "http://:secret@example.com"])(
        "rejects credentials in %s",
        (raw) => expect(rejectedWith(raw)).toBe("url_credentials"),
    );

    it.each([
        "http://127.0.0.1/",
        "http://localhost/",
        "http://10.0.0.5:8080/admin",
        "http://169.254.169.254/latest/meta-data/", // cloud metadata
        "http://[::1]/",
        "http://[fe80::1]/",
        "http://2130706433/", // decimal loopback
        "http://0x7f.1/", // hex loopback
        "http://0177.0.0.1/", // octal loopback
        "http://printer.local/",
        "127.0.0.1/path", // schemeless
    ])("rejects the non-public target %s", (raw) => {
        expect(["non_public_ip", "reserved_domain"]).toContain(rejectedWith(raw));
    });

    it.each(["https://", "https:///path", "http://exa mple.com", "https://example.com:99999/", "https://-bad.example.com/"])(
        "rejects the malformed URL %j",
        (raw) => expect(["invalid_url", "invalid_domain", "unrecognized"]).toContain(rejectedWith(raw)),
    );
});

describe("emails", () => {
    it("detects an email and exposes its domain", () => {
        expect(accepted("alice@example.com")).toEqual({ kind: "email", value: "alice@example.com", domain: "example.com" });
    });

    it("lowercases the domain but keeps the local part as typed", () => {
        expect(accepted("Alice.Smith+tag@EXAMPLE.com")).toEqual({
            kind: "email",
            value: "Alice.Smith+tag@example.com",
            domain: "example.com",
        });
    });

    it("converts an IDN domain to punycode", () => {
        expect(accepted("user@münchen.de")).toMatchObject({ domain: "xn--mnchen-3ya.de" });
    });

    it.each(["a.b-c_d@example.org", "o'brien@example.com", "x@sub.example.co.uk"])("accepts %s", (raw) => {
        expect(accepted(raw).kind).toBe("email");
    });

    it.each([
        "alice@",
        "@example.com",
        "alice@@example.com",
        "a@b@example.com",
        "alice@exampleco", // single label
        ".alice@example.com",
        "alice.@example.com",
        "al..ice@example.com",
        "alice@-example.com",
        "alice@[1.2.3.4]", // IP literal
        "alice@1.2.3.4",
        "mailto:alice@example.com",
    ])("rejects the malformed email %j", (raw) => {
        expect(rejectedWith(raw)).toBe("invalid_email");
    });

    it("rejects a local part over 64 characters", () => {
        expect(rejectedWith(`${"a".repeat(65)}@example.com`)).toBe("invalid_email");
    });

    it("rejects an address over 254 characters", () => {
        expect(rejectedWith(`a@${"b".repeat(250)}.com`)).toBe("invalid_email");
    });

    it("rejects whitespace anywhere in the input", () => {
        expect(rejectedWith("alice@exa mple.com")).toBe("unrecognized");
    });

    it.each(["me@corp.local", "me@example", "me@localhost"])("rejects an email on the reserved name %s", (raw) => {
        expect(rejectedWith(raw)).toBe("reserved_domain");
    });

    it("never mistakes URL credentials for an email", () => {
        expect(rejectedWith("https://alice@example.com")).toBe("url_credentials");
    });
});

describe("empty and oversized input", () => {
    it.each(["", "   ", "\n\t"])("rejects blank input %j", (raw) => {
        expect(rejectedWith(raw)).toBe("empty");
    });

    it("rejects input over the length limit", () => {
        expect(rejectedWith(`https://example.com/${"a".repeat(2100)}`)).toBe("too_long");
    });

    it("accepts a long but allowed URL", () => {
        expect(accepted(`https://example.com/${"a".repeat(1500)}`).kind).toBe("url");
    });
});

describe("result shape", () => {
    it("always carries a user-facing message when rejecting", () => {
        const result = detectInput("10.0.0.1");
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.message.length).toBeGreaterThan(10);
    });

    it("has a label for every input kind", () => {
        expect(Object.keys(INPUT_KIND_LABEL).sort()).toEqual(["domain", "email", "ipv4", "ipv6", "url"]);
    });

    it("is idempotent: feeding a normalized value back gives the same result", () => {
        for (const raw of ["Example.COM.", "https://MÜNCHEN.de/a#x", "2606:4700:4700:0:0:0:0:1111", "Me@Example.COM"]) {
            const first = accepted(raw);
            expect(accepted(first.value)).toEqual(first);
        }
    });
});
