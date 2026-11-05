import { describe, expect, it } from "vitest";
import type { LookupInput } from "../detect-input";
import { joinNotes, registrableDomain, targetNote, targetOf } from "../target";

const url = (hostname: string): LookupInput => ({ kind: "url", value: `https://${hostname}/x`, hostname });

describe("targetOf", () => {
    it("returns IPs and domains as they are", () => {
        expect(targetOf({ kind: "ipv4", value: "8.8.8.8" })).toEqual({ kind: "ipv4", value: "8.8.8.8" });
        expect(targetOf({ kind: "ipv6", value: "2606:4700:4700::1111" })).toEqual({ kind: "ipv6", value: "2606:4700:4700::1111" });
        expect(targetOf({ kind: "domain", value: "example.com" })).toEqual({ kind: "domain", value: "example.com" });
    });

    it("uses the domain part of an email", () => {
        expect(targetOf({ kind: "email", value: "a@example.com", domain: "example.com" })).toEqual({ kind: "domain", value: "example.com" });
    });

    it.each([
        ["www.example.com", { kind: "domain", value: "www.example.com" }],
        ["8.8.8.8", { kind: "ipv4", value: "8.8.8.8" }],
        ["2606:4700:4700::1111", { kind: "ipv6", value: "2606:4700:4700::1111" }],
    ])("classifies the host of a URL: %s", (hostname, expected) => {
        expect(targetOf(url(hostname))).toEqual(expected);
    });
});

describe("registrableDomain", () => {
    it.each([
        ["example.com", "example.com"],
        ["www.example.com", "example.com"],
        ["a.b.c.example.co.uk", "example.co.uk"],
        ["sub.example.com.au", "example.com.au"],
        ["xn--mnchen-3ya.de", "xn--mnchen-3ya.de"],
        ["foo.github.io", "github.io"],
    ])("%s -> %s", (host, expected) => {
        expect(registrableDomain(host)).toBe(expected);
    });

    it.each(["co.uk", "com", "localhost", "8.8.8.8", ""])("%j has none", (host) => {
        expect(registrableDomain(host)).toBeNull();
    });
});

describe("targetNote / joinNotes", () => {
    it("tells the reader when only part of the input was looked up", () => {
        expect(targetNote({ kind: "email", value: "a@example.com", domain: "example.com" })).toContain("example.com");
        expect(targetNote(url("www.example.com"))).toContain("www.example.com");
        expect(targetNote({ kind: "domain", value: "example.com" })).toBeUndefined();
        expect(targetNote({ kind: "ipv4", value: "8.8.8.8" })).toBeUndefined();
    });

    it("joins the notes that exist", () => {
        expect(joinNotes("A.", undefined, "B.")).toBe("A. B.");
        expect(joinNotes(undefined, undefined)).toBeUndefined();
        expect(joinNotes()).toBeUndefined();
    });
});
