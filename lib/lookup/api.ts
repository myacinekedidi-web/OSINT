/**
 * The HTTP contract of POST /api/lookup, shared by the route and (later) the page.
 * Client code should use `import type` so zod stays out of the browser bundle.
 */

import { z } from "zod";
import type { RejectReason } from "./detect-input";
import { LookupReportSchema } from "./report";

/** Largest request body accepted, in bytes. The input itself is limited further by detectInput. */
export const MAX_BODY_BYTES = 8 * 1024;

/** `{ "input": "8.8.8.8" }`. Unknown keys are rejected. */
export const LookupRequestSchema = z.strictObject({ input: z.string() });
export type LookupRequest = z.infer<typeof LookupRequestSchema>;

export const LookupResponseSchema = z.object({
    report: LookupReportSchema,
    /** Something the user should know about how the input was read, e.g. "assumed https://". */
    notice: z.string().optional(),
});
export type LookupResponse = z.infer<typeof LookupResponseSchema>;

/** Why a request failed. Rejected inputs use the router's own reason codes (HTTP 422). */
export type ApiErrorCode =
    | RejectReason
    | "forbidden_origin"
    | "unsupported_media_type"
    | "payload_too_large"
    | "invalid_json"
    | "invalid_body"
    | "internal";

export const ErrorResponseSchema = z.object({
    error: z.object({ code: z.string(), message: z.string() }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
