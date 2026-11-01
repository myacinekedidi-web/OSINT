/**
 * Input router for the lookup feature: decides what the user typed.
 *
 * Pure function, no network. Output is a discriminated union so the dispatcher can be
 * checked for exhaustiveness by the compiler. Detection order (first match wins):
 *   1. anything with a scheme ("https://...")  -> url
 *   2. anything containing "@"                 -> email
 *   3. strict dotted-decimal IPv4              -> ipv4
 *   4. IPv6 (optionally in [brackets])         -> ipv6
 *   5. "host/path", "host?query", "host#frag"  -> url (https assumed)
 *   6. otherwise                               -> domain
 *
 * Besides classifying, it normalizes (lowercase, punycode, trailing dot removed) and
 * refuses input that cannot be looked up in public data: private and reserved IPs,
 * reserved or single-label domains, URLs with credentials, non-http(s) schemes.
 */

import { isIpv4, isPublicIpv4, isPublicIpv6, normalizeIpv6 } from "./ip";

export type LookupInput =
    | { kind: "ipv4"; value: string }
    | { kind: "ipv6"; value: string }
    | { kind: "domain"; value: string }
    | { kind: "url"; value: string; hostname: string }
    | { kind: "email"; value: string; domain: string };

export type InputKind = LookupInput["kind"];

export type RejectReason =
    | "empty"
    | "too_long"
    | "unrecognized"
    | "invalid_email"
    | "invalid_domain"
    | "reserved_domain"
    | "non_public_ip"
    | "invalid_url"
    | "unsupported_url_scheme"
    | "url_credentials";

export type DetectResult =
    | { ok: true; input: LookupInput; notice?: string }
    | { ok: false; reason: RejectReason; message: string };

/** Human-readable name of each input kind (for the "Detected: ..." badge). */
export const INPUT_KIND_LABEL: Record<InputKind, string> = {
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    domain: "Domain",
    url: "URL",
    email: "Email address",
};

const MESSAGES: Record<RejectReason, string> = {
    empty: "Enter an IP address, domain, URL or email address.",
    too_long: "That input is too long.",
    unrecognized: "Enter an IP address, domain, URL or email address.",
    invalid_email: "That doesn't look like a valid email address.",
    invalid_domain: "That doesn't look like a valid domain name.",
    reserved_domain: "That domain name is reserved for local or private use, so there is nothing public to look up.",
    non_public_ip: "That address is private, reserved or not publicly routable, so there is nothing public to look up.",
    invalid_url: "That doesn't look like a valid URL.",
    unsupported_url_scheme: "Only http and https URLs are supported.",
    url_credentials: "Remove the username and password from the URL; credentials are never looked up.",
};

const MAX_INPUT_LENGTH = 2048;
const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_PART_LENGTH = 64;
const MAX_DOMAIN_LENGTH = 253;

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;

/** Top-level names that never resolve in public DNS. */
const RESERVED_TLDS = new Set([
    "localhost", "local", "localdomain", "internal", "intranet", "lan", "home", "corp",
    "invalid", "test", "example", "onion", "arpa",
]);

const fail = (reason: RejectReason): DetectResult => ({ ok: false, reason, message: MESSAGES[reason] });

type DomainResult =
    | { ok: true; domain: string }
    | { ok: false; reason: "invalid_domain" | "reserved_domain" };

/** Normalizes a hostname to lowercase ASCII (punycode) and validates it as a public domain name. */
function normalizeDomain(raw: string): DomainResult {
    let host = raw.endsWith(".") ? raw.slice(0, -1) : raw;
    // Characters that would let the URL parser read something other than a bare hostname
    if (host === "" || /[\s/?#@:\\%*]/.test(host)) return { ok: false, reason: "invalid_domain" };

    let ascii: string;
    try {
        ascii = new URL(`http://${host}`).hostname; // lowercases and converts IDNs to punycode
    } catch {
        return { ok: false, reason: "invalid_domain" };
    }
    host = ascii.endsWith(".") ? ascii.slice(0, -1) : ascii;

    const labels = host.split(".");
    if (RESERVED_TLDS.has(labels[labels.length - 1])) return { ok: false, reason: "reserved_domain" };
    if (labels.length < 2 || host.length > MAX_DOMAIN_LENGTH) return { ok: false, reason: "invalid_domain" };
    if (!labels.every((label) => LABEL.test(label)) || !TLD.test(labels[labels.length - 1])) {
        return { ok: false, reason: "invalid_domain" };
    }
    return { ok: true, domain: host };
}

function detectIp(kind: "ipv4" | "ipv6", value: string): DetectResult {
    const isPublic = kind === "ipv4" ? isPublicIpv4(value) : isPublicIpv6(value);
    return isPublic ? { ok: true, input: { kind, value } } : fail("non_public_ip");
}

function detectEmail(s: string): DetectResult {
    const at = s.indexOf("@");
    if (s.length > MAX_EMAIL_LENGTH || at <= 0 || at !== s.lastIndexOf("@")) return fail("invalid_email");

    const local = s.slice(0, at);
    if (local.length > MAX_LOCAL_PART_LENGTH || !LOCAL_PART.test(local)) return fail("invalid_email");

    const domain = normalizeDomain(s.slice(at + 1));
    if (!domain.ok) return fail(domain.reason === "reserved_domain" ? "reserved_domain" : "invalid_email");

    return { ok: true, input: { kind: "email", value: `${local}@${domain.domain}`, domain: domain.domain } };
}

function detectUrl(raw: string, notice?: string): DetectResult {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return fail("invalid_url");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return fail("unsupported_url_scheme");
    if (url.username || url.password) return fail("url_credentials");

    // The URL parser also rewrites obfuscated IPv4 forms (0x7f.1, 2130706433) to dotted decimal,
    // so the checks below see the address that would really be contacted.
    let hostname: string;
    if (url.hostname.startsWith("[")) {
        hostname = url.hostname.slice(1, -1);
        if (!isPublicIpv6(hostname)) return fail("non_public_ip");
    } else if (isIpv4(url.hostname)) {
        hostname = url.hostname;
        if (!isPublicIpv4(hostname)) return fail("non_public_ip");
    } else {
        const domain = normalizeDomain(url.hostname);
        if (!domain.ok) return fail(domain.reason);
        hostname = domain.domain;
    }

    url.hash = ""; // fragments never reach a server
    return { ok: true, input: { kind: "url", value: url.href, hostname }, ...(notice && { notice }) };
}

export function detectInput(raw: string): DetectResult {
    const s = raw.trim();
    if (s === "") return fail("empty");
    if (s.length > MAX_INPUT_LENGTH) return fail("too_long");
    if (/\s/.test(s) || /[\u0000-\u001f\u007f]/.test(s)) return fail("unrecognized");

    if (SCHEME.test(s)) return detectUrl(s);
    if (s.includes("@")) return detectEmail(s);
    if (isIpv4(s)) return detectIp("ipv4", s);

    const ipv6 = normalizeIpv6(s);
    if (ipv6) return detectIp("ipv6", ipv6);

    // "example.com/login" or "1.2.3.4:8080/x": a URL without its scheme
    if (/[/?#]/.test(s)) return detectUrl(`https://${s}`, "No scheme given: assumed https://");

    const domain = normalizeDomain(s);
    if (domain.ok) return { ok: true, input: { kind: "domain", value: domain.domain } };
    // A single word or "javascript:..." is not a malformed domain, just not something we recognize
    return fail(domain.reason === "invalid_domain" && !s.includes(".") ? "unrecognized" : domain.reason);
}
