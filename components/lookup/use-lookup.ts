"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { submitLookup, type LookupFailureKind, type SubmitFn } from "@/lib/lookup/client";
import type { LookupReport } from "@/lib/lookup/report";

export type LookupState =
    | { status: "idle" }
    | { status: "loading"; input: string }
    | { status: "success"; report: LookupReport; notice?: string }
    | { status: "error"; kind: LookupFailureKind; message: string };

/**
 * Runs lookups one at a time: starting a new one cancels the one in flight, and leaving the
 * page cancels it too. A cancelled request never touches the state.
 */
export function useLookup(submit: SubmitFn = submitLookup) {
    const [state, setState] = useState<LookupState>({ status: "idle" });
    const current = useRef<AbortController | null>(null);

    const run = useCallback(
        async (input: string) => {
            current.current?.abort();
            const controller = new AbortController();
            current.current = controller;

            setState({ status: "loading", input });
            const outcome = await submit(input, { signal: controller.signal });
            if (controller.signal.aborted) return;

            setState(
                outcome.ok
                    ? { status: "success", report: outcome.report, ...(outcome.notice && { notice: outcome.notice }) }
                    : { status: "error", kind: outcome.kind, message: outcome.message },
            );
        },
        [submit],
    );

    useEffect(() => () => current.current?.abort(), []);

    return { state, run };
}
