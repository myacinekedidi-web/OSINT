/**
 * The shape of a lookup report. Defined as zod schemas so the TypeScript types are
 * inferred from the same definition that validates them (no drift). Client code should
 * use `import type` so none of this reaches the browser bundle.
 */

import { z } from "zod";

export const SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export const SeveritySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof SeveritySchema>;

export const FINDING_CATEGORIES = ["exposure", "vulnerability", "infrastructure"] as const;
export const FindingCategorySchema = z.enum(FINDING_CATEGORIES);
export type FindingCategory = z.infer<typeof FindingCategorySchema>;

/** Identifiers of the data sources. Add one per provider. */
export const SOURCE_IDS = ["internetdb"] as const;
export const SourceIdSchema = z.enum(SOURCE_IDS);
export type SourceId = z.infer<typeof SourceIdSchema>;

/**
 * What happened when a source was asked:
 *  ok            data found
 *  no-data       the source answered but knows nothing about this input
 *  unsupported   the source cannot handle this type of input
 *  unconfigured  the source needs an API key that is not set
 *  rate-limited  the source (or our budget for it) said "slow down"
 *  timeout       no answer in time
 *  error         anything else, including a response we could not understand
 */
export const SOURCE_STATUSES = [
    "ok",
    "no-data",
    "unsupported",
    "unconfigured",
    "rate-limited",
    "timeout",
    "error",
] as const;
export const SourceStatusSchema = z.enum(SOURCE_STATUSES);
export type SourceStatus = z.infer<typeof SourceStatusSchema>;

export const FindingSchema = z.object({
    /** Stable id, e.g. "internetdb:ports". */
    id: z.string().min(1),
    title: z.string().min(1),
    severity: SeveritySchema,
    category: FindingCategorySchema,
    /** One or two sentences of context for the reader. */
    detail: z.string().optional(),
    /** Structured data for the UI to render (ports, CVE ids, ...). */
    data: z.record(z.string(), z.unknown()).optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const SourceResultSchema = z.object({
    source: SourceIdSchema,
    status: SourceStatusSchema,
    findings: z.array(FindingSchema),
    /** ISO 8601 time the source was queried. */
    fetchedAt: z.string(),
    /** How old the source's own data may be, in plain words ("refreshed weekly"). */
    freshness: z.string().optional(),
    /** Explanation shown to the user, for example why a source was skipped. */
    note: z.string().optional(),
});
export type SourceResult = z.infer<typeof SourceResultSchema>;

export const LookupReportSchema = z.object({
    input: z.object({
        kind: z.enum(["ipv4", "ipv6", "domain", "url", "email"]),
        value: z.string(),
    }),
    sources: z.array(SourceResultSchema),
    /** ISO 8601 time the report was assembled. */
    generatedAt: z.string(),
});
export type LookupReport = z.infer<typeof LookupReportSchema>;