/**
 * Runs a lookup: picks the providers that apply to the input, queries them in parallel and
 * assembles the report. Pure orchestration; no HTTP concerns (see handler.ts).
 */

import type { LookupInput } from "./detect-input";
import { runProvider, type FetchLike, type Provider } from "./provider";
import type { LookupReport } from "./report";

export type LookupDeps = {
    providers: readonly Provider[];
    fetch?: FetchLike;
    now?: () => Date;
    timeoutMs?: number;
};

/**
 * A provider appears in the report when it can handle the input, or when it explains why it
 * cannot (an `unsupportedNote`, e.g. "IPv4 only" for an IPv6 address). Providers that simply
 * do not apply (a DNS provider asked about an IP) are left out so the report stays short.
 */
function applies(provider: Provider, input: LookupInput): boolean {
    return provider.supports(input) || provider.unsupportedNote?.(input) !== undefined;
}

export async function runLookup(input: LookupInput, deps: LookupDeps): Promise<LookupReport> {
    const now = deps.now ?? (() => new Date());

    // runProvider never throws, so one failing source cannot affect the others
    const sources = await Promise.all(
        deps.providers
            .filter((provider) => applies(provider, input))
            .map((provider) => runProvider(provider, input, { fetch: deps.fetch, timeoutMs: deps.timeoutMs, now })),
    );

    return {
        input: { kind: input.kind, value: input.value },
        sources,
        generatedAt: now().toISOString(),
    };
}
