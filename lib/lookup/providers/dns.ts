/**
 * DNS records for a domain, over HTTPS (see doh.ts): addresses, name servers, mail servers,
 * TXT records, and whether SPF and DMARC are published.
 *
 * Applies to domains, to the host of a URL, and to the domain part of an email address
 * (for emails only the mail-related records are queried).
 *
 * Address records are asked for the host as typed (www.example.com); zone-level records
 * (NS, MX, TXT, DMARC) are asked for the registrable domain (example.com).
 */

import { RCODE, RR, parseMx, parseTxt, queryDns, stripDot, type DnsResult, type RecordType } from "../doh";
import { ProviderError, type Provider, type ProviderOutcome } from "../provider";
import type { Finding } from "../report";
import { joinNotes, registrableDomain, targetNote, targetOf } from "../target";

const FRESHNESS = "Live answers from a public DNS resolver; each record may be cached for up to its TTL.";
const MAX_TXT_RECORDS = 20;
const MAX_TXT_LENGTH = 300;

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();
const ofType = (result: DnsResult | undefined, type: number) => (result?.answers ?? []).filter((a) => a.type === type);
const isMail = (record: string, prefix: string) => record.toLowerCase().startsWith(prefix);

type Results = Partial<Record<"a" | "aaaa" | "ns" | "mx" | "txt" | "dmarc", DnsResult>>;

/** Turns DNS answers into findings. Pure, so it is tested without any HTTP. */
export function toFindings(results: Results): Finding[] {
    const findings: Finding[] = [];

    const cname = sorted(ofType(results.a, RR.CNAME).map((r) => stripDot(r.data).toLowerCase()));
    const v4 = sorted(ofType(results.a, RR.A).map((r) => r.data));
    const v6 = sorted(ofType(results.aaaa, RR.AAAA).map((r) => r.data.toLowerCase()));
    if (v4.length + v6.length + cname.length > 0) {
        findings.push({
            id: "dns:addresses",
            title: `Addresses (${v4.length + v6.length})`,
            severity: "info",
            category: "dns",
            detail: "Where this name points. A CNAME means it is an alias for another name.",
            data: {
                ...(cname.length > 0 && { cname }),
                ...(v4.length > 0 && { ipv4: v4 }),
                ...(v6.length > 0 && { ipv6: v6 }),
            },
        });
    }

    const ns = sorted(ofType(results.ns, RR.NS).map((r) => stripDot(r.data).toLowerCase()));
    if (ns.length > 0) {
        findings.push({
            id: "dns:ns",
            title: `Name servers (${ns.length})`,
            severity: "info",
            category: "dns",
            detail: "The servers that answer for this domain: they often reveal the DNS or hosting provider.",
            data: { nameservers: ns },
        });
    }

    const mx = ofType(results.mx, RR.MX)
        .map((r) => parseMx(r.data))
        .filter((m): m is { priority: number; host: string } => m !== null)
        .sort((a, b) => a.priority - b.priority || a.host.localeCompare(b.host));
    // RFC 7505: a single "0 ." record means the domain explicitly accepts no email
    const nullMx = mx.length === 1 && mx[0].host === "";
    const mailServers = mx.filter((m) => m.host !== "");
    if (nullMx) {
        findings.push({
            id: "dns:mx",
            title: "Does not accept email (null MX)",
            severity: "info",
            category: "dns",
            detail: "The domain publishes a null MX record: it declares that it receives no email.",
        });
    } else if (mailServers.length > 0) {
        findings.push({
            id: "dns:mx",
            title: `Mail servers (${mailServers.length})`,
            severity: "info",
            category: "dns",
            detail: "Servers that receive email for this domain, in order of preference.",
            data: { mx: mailServers.map((m) => `${m.priority} ${m.host}`) },
        });
    }

    const txt = ofType(results.txt, RR.TXT).map((r) => parseTxt(r.data));
    const spf = txt.filter((record) => isMail(record, "v=spf1"));
    const dmarc = ofType(results.dmarc, RR.TXT)
        .map((r) => parseTxt(r.data))
        .filter((record) => isMail(record, "v=dmarc1"));

    // Only meaningful when we actually asked for the mail records
    if (results.txt || results.dmarc) {
        const mailCapable = mailServers.length > 0;
        const incomplete = spf.length === 0 || dmarc.length === 0;
        findings.push({
            id: "dns:email-auth",
            title: `Email authentication: SPF ${spf.length > 0 ? "found" : "missing"}, DMARC ${dmarc.length > 0 ? "found" : "missing"}`,
            // A domain that receives mail but lacks SPF or DMARC is easier to impersonate
            severity: mailCapable && incomplete ? "low" : "info",
            category: "dns",
            detail:
                "SPF and DMARC tell receivers which servers may send mail for the domain. Without them, forged mail is easier to pass off as genuine.",
            ...((spf.length > 0 || dmarc.length > 0) && {
                data: { ...(spf.length > 0 && { spf }), ...(dmarc.length > 0 && { dmarc }) },
            }),
        });
    }

    const otherTxt = txt.filter((record) => !isMail(record, "v=spf1"));
    if (otherTxt.length > 0) {
        const shown = sorted(otherTxt).slice(0, MAX_TXT_RECORDS).map((r) => (r.length > MAX_TXT_LENGTH ? `${r.slice(0, MAX_TXT_LENGTH)}…` : r));
        findings.push({
            id: "dns:txt",
            title: `TXT records (${otherTxt.length})`,
            severity: "info",
            category: "dns",
            detail:
                "Free-form records. Verification tokens here often reveal which services the domain uses (email, analytics, SaaS).",
            data: { txt: shown },
        });
    }

    return findings;
}

export const dns: Provider = {
    id: "dns",

    supports: (input) => targetOf(input).kind === "domain",

    async lookup(input, ctx): Promise<ProviderOutcome> {
        const target = targetOf(input);
        if (target.kind !== "domain") throw new ProviderError("error", "Unsupported input type.");

        const host = target.value;
        const zone = registrableDomain(host) ?? host;
        const mailOnly = input.kind === "email";

        const queries: [keyof Results, string, RecordType][] = [
            ...(mailOnly ? [] : ([["a", host, "A"], ["aaaa", host, "AAAA"]] as [keyof Results, string, RecordType][])),
            ["ns", zone, "NS"],
            ["mx", zone, "MX"],
            ["txt", zone, "TXT"],
            ["dmarc", `_dmarc.${zone}`, "TXT"],
        ];

        const settled = await Promise.allSettled(queries.map(([, name, type]) => queryDns(name, type, ctx)));

        const results: Results = {};
        const failed: string[] = [];
        let firstError: unknown;
        settled.forEach((outcome, index) => {
            const [key, , type] = queries[index];
            if (outcome.status === "fulfilled") results[key] = outcome.value;
            else {
                failed.push(type);
                firstError ??= outcome.reason;
            }
        });

        // Nothing came back at all: let the runner turn the first failure into a status
        if (Object.keys(results).length === 0) throw firstError;

        const primary = results.a ?? results.ns;
        if (primary?.rcode === RCODE.NXDOMAIN) {
            return {
                status: "no-data",
                findings: [],
                freshness: FRESHNESS,
                note: joinNotes(targetNote(input), `${host} does not exist in DNS (NXDOMAIN).`),
            };
        }
        if (primary?.rcode === RCODE.SERVFAIL) {
            throw new ProviderError("error", `The DNS resolver could not resolve ${host} (SERVFAIL). Its name servers may be misconfigured or unreachable.`);
        }

        const findings = toFindings(results);
        const incomplete = failed.length > 0 ? `Some record types could not be fetched: ${sorted(failed).join(", ")}.` : undefined;

        if (findings.length === 0) {
            return {
                status: "no-data",
                findings: [],
                freshness: FRESHNESS,
                note: joinNotes(targetNote(input), `${host} has no DNS records of the types checked.`, incomplete),
            };
        }
        return { status: "ok", findings, freshness: FRESHNESS, note: joinNotes(targetNote(input), incomplete) };
    },
};
