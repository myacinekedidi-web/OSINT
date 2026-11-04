/**
 * Browser-side client for POST /api/lookup. Turns every possible outcome (success, the
 * server's own error responses, a firewall page, a dropped connection, a cancelled request)
 * into one small union so the UI never has to deal with exceptions or raw responses.
 *
 * Client-safe: type-only imports, no zod.
 */

import type { LookupReport } from "./report";

export const LOOKUP_ENDPOINT = "/api/lookup";

export type LookupFailureKind =
    | "rejected" // the server understood the request and refused the input (4xx with a message)
    | "rate_limited" // HTTP 429, usually from the platform firewall
    | "network" // could not reach the server
    | "server" // 5xx
    | "invalid_response" // something that is not our API answered
    | "aborted"; // the caller cancelled

export type LookupOutcome =
    | { ok: true; report: LookupReport; notice?: string }
    | { ok: false; kind: LookupFailureKind; message: string; code?: string };

export type SubmitOptions = { signal?: AbortSignal; fetch?: typeof fetch };
export type SubmitFn = (input: string, options?: SubmitOptions) => Promise<LookupOutcome>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";

/** Structural check of a success response (the server validates its side; this guards against anything else answering). */
export function isLookupResponse(json: unknown): json is { report: LookupReport; notice?: string } {
    if (!isRecord(json) || !isRecord(json.report)) return false;
    const { input, sources, generatedAt } = json.report;
    if (json.notice !== undefined && !isString(json.notice)) return false;
    if (!isRecord(input) || !isString(input.kind) || !isString(input.value)) return false;
    if (!isString(generatedAt) || !Array.isArray(sources)) return false;
    return sources.every(
        (source) =>
            isRecord(source) &&
            isString(source.source) &&
            isString(source.status) &&
            isString(source.fetchedAt) &&
            Array.isArray(source.findings) &&
            source.findings.every(
                (finding) =>
                    isRecord(finding) && isString(finding.id) && isString(finding.title) && isString(finding.severity),
            ),
    );
}

const isAbort = (error: unknown) =>
    error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");

export const submitLookup: SubmitFn = async (input, options = {}) => {
    const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

    let response: Response;
    try {
        response = await doFetch(LOOKUP_ENDPOINT, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ input }),
            signal: options.signal,
        });
    } catch (error) {
        if (isAbort(error)) return { ok: false, kind: "aborted", message: "The lookup was cancelled." };
        return { ok: false, kind: "network", message: "Could not reach the server. Check your connection and try again." };
    }

    // The platform firewall answers 429 with its own (non-JSON) page
    // FIX: either keep and add condition for DENY 403 or replace
    if (response.status === 429) {
        return {
            ok: false,
            kind: "rate_limited",
            message: "Too many lookups in a short time. Wait a minute and try again.",
        };
    }

    let json: unknown = null;
    try {
        json = await response.json();
    } catch {
        // not JSON (an HTML error page, an empty body, or the request was aborted while reading)
    }

    if (response.ok) {
        if (isLookupResponse(json)) {
            return { ok: true, report: json.report, ...(json.notice !== undefined && { notice: json.notice }) };
        }
        return { ok: false, kind: "invalid_response", message: "The server sent an unexpected response. Please try again." };
    }

    const kind: LookupFailureKind = response.status >= 500 ? "server" : "rejected";
    if (isRecord(json) && isRecord(json.error) && isString(json.error.message)) {
        return {
            ok: false,
            kind,
            message: json.error.message,
            ...(isString(json.error.code) && { code: json.error.code }),
        };
    }
    return {
        ok: false,
        kind: response.status >= 500 ? "server" : "invalid_response",
        message: "The server sent an unexpected response. Please try again.",
    };
};
