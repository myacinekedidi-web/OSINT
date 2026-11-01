import { describe, expect, it } from "vitest";
import { isIpv4, isPublicIpv4, isPublicIpv6, normalizeIpv6 } from "../ip";

describe("isIpv4", () => {
    it.each(["0.0.0.0", "8.8.8.8", "255.255.255.255", "192.168.1.10"])("accepts %s", (ip) => {
        expect(isIpv4(ip)).toBe(true);
    });

    it.each([
        "",
        "1.2.3",
        "1.2.3.4.5",
        "256.1.1.1",
        "1.2.3.256",
        "01.2.3.4", // leading zero: octal in some parsers
        "1.2.3.04",
        "0x7f.0.0.1",
        "127.1", // shorthand
        "2130706433", // decimal form of 127.0.0.1
        " 1.2.3.4",
        "1.2.3.4 ",
        "1.2.3.4/24",
        "a.b.c.d",
        "1..2.3",
    ])("rejects %j", (ip) => {
        expect(isIpv4(ip)).toBe(false);
    });
});

describe("isPublicIpv4", () => {
    it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.0.1", "172.32.0.1", "100.63.255.255", "100.128.0.1", "198.17.0.1", "198.20.0.1"])(
        "%s is public",
        (ip) => expect(isPublicIpv4(ip)).toBe(true),
    );

    it.each([
        "0.0.0.0",
        "0.1.2.3",
        "10.0.0.1",
        "10.255.255.255",
        "100.64.0.1", // carrier-grade NAT
        "100.127.255.255",
        "127.0.0.1",
        "127.255.255.254",
        "169.254.169.254", // link-local / cloud metadata
        "172.16.0.1",
        "172.31.255.255",
        "192.0.0.1",
        "192.0.2.1",
        "192.88.99.1",
        "192.168.0.1",
        "198.18.0.1",
        "198.19.255.255",
        "198.51.100.7",
        "203.0.113.9",
        "224.0.0.1",
        "239.255.255.255",
        "240.0.0.1",
        "255.255.255.255",
    ])("%s is not public", (ip) => expect(isPublicIpv4(ip)).toBe(false));
});

describe("normalizeIpv6", () => {
    it.each([
        ["2001:DB8:0:0:0:0:0:1", "2001:db8::1"],
        ["2001:0db8:0000:0000:0000:0000:0000:0001", "2001:db8::1"],
        ["[2001:db8::1]", "2001:db8::1"],
        ["::1", "::1"],
        ["::", "::"],
        ["::ffff:1.2.3.4", "::ffff:102:304"],
        ["2606:4700:4700::1111", "2606:4700:4700::1111"],
    ])("%s -> %s", (input, expected) => {
        expect(normalizeIpv6(input)).toBe(expected);
    });

    it.each([
        "",
        "1.2.3.4",
        "example.com",
        "fe80::1%eth0", // zone id
        "1:2:3:4:5:6:7:8:9",
        "12345::",
        "1::2::3",
        "gggg::1",
        "[::1",
        "::1]",
        "2001:db8::1/64",
        "http://[::1]/",
    ])("rejects %j", (input) => {
        expect(normalizeIpv6(input)).toBeNull();
    });
});

describe("isPublicIpv6", () => {
    it.each([
        "2606:4700:4700::1111", // Cloudflare
        "2001:4860:4860::8888", // Google
        "2001:200::1", // first real allocation after the special-purpose block
        "2a00:1450:4001:81b::200e",
        "2002:808:808::1", // 6to4 embedding 8.8.8.8
    ])("%s is public", (ip) => expect(isPublicIpv6(ip)).toBe(true));

    it.each([
        "::", // unspecified
        "::1", // loopback
        "fe80::1", // link-local
        "fc00::1", // unique local
        "fd12:3456:789a::1",
        "ff02::1", // multicast
        "::ffff:808:808", // IPv4-mapped
        "64:ff9b::808:808", // NAT64
        "100::1", // discard-only
        "2001::1", // Teredo / IETF special-purpose
        "2001:1::1",
        "2001:db8::1", // documentation
        "3fff::1", // documentation (RFC 9637)
        "3fff:fff::1",
        "2002:7f00:1::", // 6to4 embedding 127.0.0.1
        "2002:a00:1::", // 6to4 embedding 10.0.0.1
        "fec0::1", // deprecated site-local
    ])("%s is not public", (ip) => expect(isPublicIpv6(ip)).toBe(false));
});
