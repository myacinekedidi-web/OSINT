/**
 * The contract every data source implements, and the runner that makes sure a source can
 * never break a report: whatever happens inside a provider (bad data, timeout, HTTP error,
 * a thrown exception) comes out as a SourceResult with a status, never as an exception.
 */

import { z } from "zod";
import type { LookupInput } from "./detect-input";
import type { Finding, SourceId, SourceResult, SourceStatus } from "./report";

export type FetchLike = typeof fetch;

/** What a provider receives. `fetch` is injectable so tests never touch the network. */
export type ProviderContext = {
    signal: AbortSignal;
    fetch: FetchLike;
    now: () => Date;
};

/** What a provider returns when it got an answer. The runner adds `source` and `fetchedAt`. */
export type ProviderOutcome = {
    status: "ok" | "no-data";
    findings: Finding[];
    freshness?: string;
    note?: string;
};

export interface Provider {
    readonly id: SourceId;
    /** Can this provider handle this input at all? */
    supports(input: LookupInput): boolean;
    /** Why `supports` is false, when that is worth telling the user (otherwise omit). */
    unsupportedNote?(input: LookupInput): string | undefined;
    lookup(input: LookupInput, ctx: ProviderContext): Promise<ProviderOutcome>;
}

/**
 * Throw this from a provider to report a specific, expected failure. The message becomes
 * the note shown to the user, so keep it short and free of internals.
 */
export class ProviderError extends Error {
    constructor(
        readonly status: Exclude<SourceStatus, "ok" | "no-data" | "unsupported">,
        message: string,
    ) {
        super(message);
        this.name = "ProviderError";
    }
}

export const DEFAULT_TIMEOUT_MS = 8000;

export type RunOptions = {
    fetch?: FetchLike;
    timeoutMs?: number;
    now?: () => Date;
};

const isAbort = (error: unknown): boolean =>
    error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

export async function runProvider(
    provider: Provider,
    input: LookupInput,
    options: RunOptions = {},
): Promise<SourceResult> {
    const now = options.now ?? (() => new Date());
    const result = (status: SourceStatus, extra: Partial<SourceResult> = {}): SourceResult => ({
        source: provider.id,
        status,
        findings: [],
        fetchedAt: now().toISOString(),
        ...extra,
    });

    if (!provider.supports(input)) {
        return result("unsupported", {
            note: provider.unsupportedNote?.(input) ?? "This source does not handle this type of input.",
        });
    }

    try {
        const outcome = await provider.lookup(input, {
            signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
            fetch: options.fetch ?? fetch,
            now,
        });
        return result(outcome.status, {
            findings: outcome.findings,
            ...(outcome.freshness && { freshness: outcome.freshness }),
            ...(outcome.note && { note: outcome.note }),
        });
    } catch (error) {
        if (error instanceof ProviderError) return result(error.status, { note: error.message });
        if (isAbort(error)) return result("timeout", { note: "The data source did not respond in time." });
        if (error instanceof z.ZodError) {
            return result("error", { note: "The data source returned a response in an unexpected format." });
        }
        // Anything else: say nothing about the cause, it may contain internals
        return result("error", { note: "The data source could not be queried." });
    }
}
