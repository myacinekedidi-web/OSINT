/**
 * "What host is this input really about?" Domain, URL and email inputs all point at a host;
 * the providers that work on hosts use this instead of each re-implementing the extraction.
 * Pure and client-safe apart from the public-suffix list in `tldts`.
 */

import { getDomain } from "tldts";
import type { LookupInput } from "./detect-input";
import { isIpv4 } from "./ip";

export type Target =
    | { kind: "ipv4"; value: string }
    | { kind: "ipv6"; value: string }
    | { kind: "domain"; value: string };

/** The host an input is about: the input itself for an IP or domain, the host of a URL, the domain part of an email. */
export function targetOf(input: LookupInput): Target {
    switch (input.kind) {
        case "ipv4":
        case "ipv6":
        case "domain":
            return { kind: input.kind, value: input.value };
        case "email":
            return { kind: "domain", value: input.domain };
        case "url":
            if (input.hostname.includes(":")) return { kind: "ipv6", value: input.hostname };
            if (isIpv4(input.hostname)) return { kind: "ipv4", value: input.hostname };
            return { kind: "domain", value: input.hostname };
    }
}

/** The domain a registry knows about ("www.example.co.uk" -> "example.co.uk"), or null for a bare public suffix. */
export function registrableDomain(domain: string): string | null {
    return getDomain(domain);
}

/** For reports: tell the reader when we looked at part of what they typed. */
export function targetNote(input: LookupInput): string | undefined {
    if (input.kind === "email") return `Looked up the domain part of the address: ${input.domain}.`;
    if (input.kind === "url") return `Looked up the host of the URL: ${input.hostname}.`;
    return undefined;
}

/** Joins the optional notes of a provider into one string. */
export function joinNotes(...notes: (string | undefined)[]): string | undefined {
    const present = notes.filter((note): note is string => Boolean(note));
    return present.length > 0 ? present.join(" ") : undefined;
}
