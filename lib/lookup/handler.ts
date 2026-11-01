/**
 * The logic behind POST /api/lookup, kept out of app/api/lookup/route.ts because Next.js
 * route files may only export HTTP method handlers (and so that it can be tested by simply
 * calling it with a Request).
 *
 * Order of checks: origin, content type, body size, JSON syntax, body shape, input
 * detection (always repeated here: the client's own check is never trusted), then the lookup.
 *
 * Privacy: nothing about the input or the results is stored or logged. The log line holds
 * the input *type*, timing and per-source status only.
 */

import {
    LookupRequestSchema,
    MAX_BODY_BYTES,
    type ApiErrorCode,
    type ErrorResponse,
    type LookupResponse,
} from "./api";
import { detectInput } from "./detect-input";
import { BodyTooLargeError, readBodyLimited } from "./http";
import { runLookup, type LookupDeps } from "./lookup";
import { PROVIDERS } from "./registry";

export type HandlerDeps = LookupDeps & {
    /** Receives the one structured log line per request. Defaults to console.info. */
    log?: (entry: Record<string, unknown>) => void;
};

const HEADERS = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
} as const;

function json(body: LookupResponse | ErrorResponse, status: number): Response {
    return Response.json(body, { status, headers: HEADERS });
}

function problem(status: number, code: ApiErrorCode, message: string): Response {
    return json({ error: { code, message } }, status);
}

export async function handleLookup(
    request: Request,
    deps: HandlerDeps = { providers: PROVIDERS },
): Promise<Response> {
    const log = deps.log ?? ((entry) => console.info(JSON.stringify(entry)));
    const started = Date.now();

    try {
        // Browsers label the origin of every request. Refusing cross-site ones stops other
        // websites from using their visitors' browsers to spend our upstream quota.
        // (Non-browser clients send no such header and are handled by the rate limit.)
        if (request.headers.get("sec-fetch-site") === "cross-site") {
            return problem(403, "forbidden_origin", "Cross-site requests are not allowed.");
        }

        // Also forces a CORS preflight for cross-origin scripts, which we never approve
        if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
            return problem(415, "unsupported_media_type", "Send the request as application/json.");
        }

        let text: string;
        try {
            text = await readBodyLimited(request, MAX_BODY_BYTES);
        } catch (error) {
            if (error instanceof BodyTooLargeError) {
                return problem(413, "payload_too_large", "The request is too large.");
            }
            throw error;
        }

        let body: unknown;
        try {
            body = JSON.parse(text);
        } catch {
            return problem(400, "invalid_json", "The request body is not valid JSON.");
        }

        const parsed = LookupRequestSchema.safeParse(body);
        if (!parsed.success) {
            return problem(400, "invalid_body", 'Expected a JSON object like { "input": "8.8.8.8" }.');
        }

        const detected = detectInput(parsed.data.input);
        if (!detected.ok) {
            log({ event: "lookup_rejected", reason: detected.reason, durationMs: Date.now() - started });
            return problem(422, detected.reason, detected.message);
        }

        const report = await runLookup(detected.input, deps);

        log({
            event: "lookup",
            kind: report.input.kind,
            durationMs: Date.now() - started,
            sources: Object.fromEntries(report.sources.map((source) => [source.source, source.status])),
        });

        return json({ report, ...(detected.notice && { notice: detected.notice }) }, 200);
    } catch {
        // No error details in the log or the response: they could contain the input
        log({ event: "lookup_error", durationMs: Date.now() - started });
        return problem(500, "internal", "Something went wrong. Please try again.");
    }
}
