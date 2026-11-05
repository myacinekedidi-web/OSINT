/**
 * RDAP: who registered a domain, when, through which registrar, and its status. RDAP is the
 * modern replacement for WHOIS and returns JSON.
 *
 * How the registry is found (RFC 9224): IANA publishes a bootstrap file that maps each top-level
 * domain to its registry's RDAP server. We fetch it once per day (cached in memory, shared by
 * concurrent requests) and query the registry directly. Only if the bootstrap file itself cannot
 * be fetched do we fall back to rdap.org, which redirects to the right registry, and which
 * limits clients to 10 requests per 10 seconds (and our function's IP is shared by all visitors).
 *
 * Privacy: registrant, administrative and technical contacts are deliberately ignored. Only the
 * registrar (a company) is reported.
 *
 * We never follow links found inside responses.
 */

import { z } from "zod";
import { getJson } from "../http";
import { ProviderError, type Provider, type ProviderContext, type ProviderOutcome } from "../provider";
import type { Finding } from "../report";
import { isIpv4 } from "../ip";
import { joinNotes, registrableDomain, targetNote, targetOf } from "../target";

const BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const FALLBACK_URL = "https://rdap.org/domain/";
const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000;
const RDAP_ACCEPT = "application/rdap+json, application/json";
const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_DAYS = 30;

const FRESHNESS = "Registry data as of this query. Registrant details are usually redacted and are not shown here.";

/** RFC 9224: services is a list of [ [tld, ...], [baseUrl, ...] ]. Anything extra is ignored. */
const BootstrapSchema = z.object({ services: z.array(z.array(z.array(z.string()))) });

export type BootstrapService = { tlds: string[]; urls: string[] };

export const RdapDomainSchema = z.object({
    status: z.array(z.string()).default([]),
    events: z.array(z.object({ eventAction: z.string(), eventDate: z.string() })).default([]),
    nameservers: z.array(z.object({ ldhName: z.string().optional() })).default([]),
    entities: z.array(z.object({ roles: z.array(z.string()).default([]), vcardArray: z.unknown().optional() })).default([]),
    secureDNS: z.object({ delegationSigned: z.boolean().optional() }).optional(),
});
export type RdapDomain = z.infer<typeof RdapDomainSchema>;

/** A registry URL is only used if it is plain https to a named host (never an IP, never localhost). */
export function isAllowedRdapBase(value: string): boolean {
    try {
        const url = new URL(value);
        return (
            url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            !isIpv4(url.hostname) &&
            !url.hostname.startsWith("[") &&
            url.hostname.includes(".") &&
            !/(^|\.)(localhost|local|internal)$/.test(url.hostname)
        );
    } catch {
        return false;
    }
}

/** Label-wise longest match of the domain against the bootstrap entries; the first usable https server wins. */
export function findRdapBase(services: readonly BootstrapService[], domain: string): string | null {
    let best: { length: number; url: string } | null = null;
    for (const service of services) {
        const url = service.urls.find(isAllowedRdapBase);
        if (!url) continue;
        for (const tld of service.tlds) {
            const pattern = tld.toLowerCase();
            if ((domain === pattern || domain.endsWith(`.${pattern}`)) && (!best || pattern.length > best.length)) {
                best = { length: pattern.length, url };
            }
        }
    }
    return best ? (best.url.endsWith("/") ? best.url : `${best.url}/`) : null;
}

const norm = (status: string) => status.toLowerCase().replace(/[^a-z]/g, "");
/** Statuses that mean the domain is suspended or on its way out. */
const TROUBLE_STATUSES = new Set(["serverhold", "clienthold", "pendingdelete", "redemptionperiod"]);

function registrarName(entities: RdapDomain["entities"]): string | undefined {
    const registrar = entities.find((entity) => entity.roles.some((role) => role.toLowerCase() === "registrar"));
    const card = registrar?.vcardArray;
    if (!Array.isArray(card) || !Array.isArray(card[1])) return undefined;
    for (const property of card[1] as unknown[]) {
        if (Array.isArray(property) && property[0] === "fn" && typeof property[3] === "string") return property[3];
    }
    return undefined;
}

const day = (iso: string | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : undefined);

function eventDate(events: RdapDomain["events"], action: string): string | undefined {
    return day(events.find((event) => event.eventAction.toLowerCase() === action)?.eventDate);
}

/** Turns an RDAP domain record into findings. Pure; `now` is injected for the age check. */
export function toFindings(record: RdapDomain, now: Date): Finding[] {
    const findings: Finding[] = [];

    const registrar = registrarName(record.entities);
    const registered = eventDate(record.events, "registration");
    const expires = eventDate(record.events, "expiration");
    const updated = eventDate(record.events, "last changed");
    const nameservers = [...new Set(record.nameservers.map((n) => n.ldhName?.toLowerCase()).filter((n): n is string => Boolean(n)))].sort();
    const dnssec = record.secureDNS?.delegationSigned;

    const data = {
        ...(registrar && { registrar: [registrar] }),
        ...(registered && { registered: [registered] }),
        ...(expires && { expires: [expires] }),
        ...(updated && { updated: [updated] }),
        ...(dnssec !== undefined && { dnssec: [dnssec ? "signed" : "not signed"] }),
        ...(nameservers.length > 0 && { nameservers }),
    };
    if (Object.keys(data).length > 0) {
        findings.push({
            id: "rdap:registration",
            title: "Registration",
            severity: "info",
            category: "registration",
            detail: "From the domain registry. Dates are UTC.",
            data,
        });
    }

    if (registered) {
        const age = Math.floor((now.getTime() - Date.parse(registered)) / DAY_MS);
        if (age >= 0 && age < RECENT_DAYS) {
            findings.push({
                id: "rdap:recent",
                title: `Registered recently (${age === 0 ? "today" : `${age} day${age === 1 ? "" : "s"} ago`})`,
                severity: "low",
                category: "registration",
                detail:
                    "Newly registered domains are more often used for phishing and other abuse. Many are perfectly legitimate: treat it as a prompt to look closer, not a verdict.",
                data: { registered: [registered] },
            });
        }
    }

    if (record.status.length > 0) {
        const trouble = record.status.some((status) => TROUBLE_STATUSES.has(norm(status)));
        findings.push({
            id: "rdap:status",
            title: trouble ? "Domain is suspended or being deleted" : `Status (${record.status.length})`,
            severity: trouble ? "medium" : "info",
            category: "registration",
            detail: trouble
                ? "The registry or registrar has put this domain on hold or started deleting it, so it may not resolve."
                : "Registry status flags. Most are routine protections against accidental changes or transfers.",
            data: { status: [...record.status].sort() },
        });
    }

    return findings;
}

type BootstrapOptions = { ttlMs?: number };

/**
 * Builds the RDAP provider. Each instance keeps its own bootstrap cache, so tests get a clean
 * one; the exported `rdap` is the one the app uses.
 */
export function createRdapProvider(options: BootstrapOptions = {}): Provider {
    const ttl = options.ttlMs ?? BOOTSTRAP_TTL_MS;
    let cached: { services: BootstrapService[]; at: number } | null = null;
    let inflight: Promise<BootstrapService[]> | null = null;

    async function bootstrap(ctx: ProviderContext): Promise<BootstrapService[]> {
        if (cached && ctx.now().getTime() - cached.at < ttl) return cached.services;
        // Concurrent lookups share one download
        inflight ??= (async () => {
            const { json } = await getJson(BOOTSTRAP_URL, ctx, { maxBytes: 2_000_000 });
            const services = BootstrapSchema.parse(json).services.flatMap((entry) =>
                entry.length >= 2 ? [{ tlds: entry[0], urls: entry[1] }] : [],
            );
            cached = { services, at: ctx.now().getTime() };
            return services;
        })().finally(() => {
            inflight = null;
        });
        return inflight;
    }

    return {
        id: "rdap",

        supports: (input) => {
            const target = targetOf(input);
            return target.kind === "domain" && registrableDomain(target.value) !== null;
        },

        unsupportedNote: (input) => {
            const target = targetOf(input);
            return target.kind === "domain" && registrableDomain(target.value) === null
                ? "That name is a public suffix, not a registered domain, so it has no registration record."
                : undefined;
        },

        async lookup(input, ctx): Promise<ProviderOutcome> {
            const target = targetOf(input);
            const domain = target.kind === "domain" ? registrableDomain(target.value) : null;
            if (!domain) throw new ProviderError("error", "Unsupported input type.");

            // Where to ask: the registry named by the IANA bootstrap, or rdap.org if that file is unavailable
            let url: string;
            let redirect: RequestRedirect = "error";
            try {
                const base = findRdapBase(await bootstrap(ctx), domain);
                if (!base) {
                    const tld = domain.slice(domain.lastIndexOf(".") + 1);
                    return {
                        status: "no-data",
                        findings: [],
                        note: joinNotes(targetNote(input), `The registry for .${tld} does not publish RDAP data.`),
                    };
                }
                url = `${base}domain/${encodeURIComponent(domain)}`;
            } catch (error) {
                if (ctx.signal.aborted) throw error;
                url = `${FALLBACK_URL}${encodeURIComponent(domain)}`;
                redirect = "follow";
            }

            const { status, json } = await getJson(url, ctx, { redirect, headers: { accept: RDAP_ACCEPT } });
            if (status === 404) {
                return {
                    status: "no-data",
                    findings: [],
                    freshness: FRESHNESS,
                    note: joinNotes(targetNote(input), `The registry has no record of ${domain}: it may not be registered.`),
                };
            }

            const findings = toFindings(RdapDomainSchema.parse(json), ctx.now());
            const registrableNote =
                target.value !== domain ? `Registration data is for the registered domain ${domain}.` : undefined;
            if (findings.length === 0) {
                return { status: "no-data", findings: [], freshness: FRESHNESS, note: joinNotes(targetNote(input), registrableNote) };
            }
            return { status: "ok", findings, freshness: FRESHNESS, note: joinNotes(targetNote(input), registrableNote) };
        },
    };
}

export const rdap = createRdapProvider();
