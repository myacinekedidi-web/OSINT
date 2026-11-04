"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, Search, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { detectInput, INPUT_KIND_LABEL } from "@/lib/lookup/detect-input";
import type { SubmitFn } from "@/lib/lookup/client";
import { SOURCE_INFO } from "@/lib/lookup/labels";
import { describeSummary, summarizeReport } from "@/lib/lookup/summary";
import { ReportView } from "./report-view";
import { useLookup } from "./use-lookup";

type Props = {
    /** Replaceable so tests never touch the network. */
    submit?: SubmitFn;
};

export function LookupWorkbench({ submit }: Props) {
    const inputId = useId();
    const hintId = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const headingRef = useRef<HTMLHeadingElement>(null);

    const [value, setValue] = useState("");
    // True after a submit attempt with an input that cannot be looked up
    const [attempted, setAttempted] = useState(false);

    const { state, run } = useLookup(submit);
    const loading = state.status === "loading";

    // What the router makes of the text, live. Cheap enough to compute on every keystroke.
    const detected = detectInput(value);
    const empty = value.trim() === "";
    const invalid = !empty && !detected.ok;

    // After a lookup finishes, move focus to the report so the result is not missed
    useEffect(() => {
        if (state.status === "success") headingRef.current?.focus();
    }, [state]);

    const onSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        if (loading || empty) return;
        if (!detected.ok) {
            setAttempted(true);
            inputRef.current?.focus();
            return;
        }
        void run(value);
    };

    let hint: React.ReactNode;
    if (empty) {
        hint = "Enter an IP address, domain, URL or email address.";
    } else if (detected.ok) {
        hint = (
            <>
                Detected: <strong>{INPUT_KIND_LABEL[detected.input.kind]}</strong>
                {detected.notice ? ` · ${detected.notice}` : ""}
            </>
        );
    } else {
        hint = detected.message;
    }

    const sources = Object.values(SOURCE_INFO);

    return (
        <div className="space-y-6">
            <form onSubmit={onSubmit} className="space-y-2" aria-busy={loading} noValidate>
                <label htmlFor={inputId} className="text-sm font-medium">
                    What do you want to look up?
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <InputGroup className="sm:flex-1">
                        <InputGroupAddon>
                            <Search aria-hidden="true" />
                        </InputGroupAddon>
                        <InputGroupInput
                            ref={inputRef}
                            id={inputId}
                            value={value}
                            onChange={(event) => {
                                setValue(event.target.value);
                                setAttempted(false);
                            }}
                            placeholder="8.8.8.8, example.com, https://example.com/page, name@example.com"
                            aria-describedby={hintId}
                            aria-invalid={attempted && invalid ? true : undefined}
                            autoComplete="off"
                            autoCapitalize="none"
                            spellCheck={false}
                        />
                    </InputGroup>
                    <Button type="submit" disabled={loading || empty}>
                        {loading ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Search aria-hidden="true" />}
                        {loading ? "Looking up…" : "Look up"}
                    </Button>
                </div>
                <p
                    id={hintId}
                    className={`text-sm ${attempted && invalid ? "text-destructive" : "text-muted-foreground"}`}
                >
                    {hint}
                </p>
            </form>

            {/* Announces progress and results to screen readers without moving focus */}
            <p role="status" className="sr-only">
                {state.status === "loading" && "Looking up…"}
                {state.status === "success" && `Report ready. ${describeSummary(summarizeReport(state.report))}.`}
            </p>

            {state.status === "error" && state.kind !== "aborted" && (
                <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    <p>{state.message}</p>
                </div>
            )}

            {state.status === "success" && (
                <ReportView report={state.report} notice={state.notice} headingRef={headingRef} />
            )}

            <aside className="space-y-1 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
                <p>
                    <strong className="font-medium text-foreground">Privacy.</strong> This site does not store what you look
                    up or the results. Your input is sent to the data sources that apply to it:{" "}
                    {sources.map((source, index) => (
                        <span key={source.name}>
                            {index > 0 && "; "}
                            {source.name} ({source.covers})
                        </span>
                    ))}
                    .
                </p>
                <p>
                    Results are informational and can be outdated or wrong. Verify them independently, and only look up
                    things you are allowed to.
                </p>
            </aside>
        </div>
    );
}
