// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { LookupOutcome, SubmitFn } from "../../../lib/lookup/client";
import { sampleReport } from "../../../lib/lookup/tests/fixtures";
import { useLookup } from "../use-lookup";

/** A submit function the test resolves by hand, remembering the signal it was given. */
function controllable() {
    const calls: { input: string; signal: AbortSignal; resolve: (outcome: LookupOutcome) => void }[] = [];
    const submit: SubmitFn = (input, options) =>
        new Promise((resolve) => {
            calls.push({ input, signal: options!.signal!, resolve });
        });
    return { submit, calls };
}

const success: LookupOutcome = { ok: true, report: sampleReport() };

describe("useLookup", () => {
    it("starts idle, then loading, then success", async () => {
        const { submit, calls } = controllable();
        const { result } = renderHook(() => useLookup(submit));
        expect(result.current.state).toEqual({ status: "idle" });

        let done!: Promise<void>;
        act(() => {
            done = result.current.run("8.8.8.8");
        });
        expect(result.current.state).toEqual({ status: "loading", input: "8.8.8.8" });

        await act(async () => {
            calls[0].resolve({ ...success, notice: "n" });
            await done;
        });
        expect(result.current.state).toEqual({ status: "success", report: sampleReport(), notice: "n" });
    });

    it("turns a failure into an error state", async () => {
        const { submit, calls } = controllable();
        const { result } = renderHook(() => useLookup(submit));

        let done!: Promise<void>;
        act(() => {
            done = result.current.run("x");
        });
        await act(async () => {
            calls[0].resolve({ ok: false, kind: "network", message: "Offline." });
            await done;
        });
        expect(result.current.state).toEqual({ status: "error", kind: "network", message: "Offline." });
    });

    it("cancels the lookup in flight when a new one starts, and ignores its late answer", async () => {
        const { submit, calls } = controllable();
        const { result } = renderHook(() => useLookup(submit));

        let first!: Promise<void>;
        let second!: Promise<void>;
        act(() => {
            first = result.current.run("1.1.1.1");
        });
        act(() => {
            second = result.current.run("8.8.8.8");
        });
        expect(calls[0].signal.aborted).toBe(true);
        expect(calls[1].signal.aborted).toBe(false);

        await act(async () => {
            calls[1].resolve(success);
            await second;
        });
        // The first request answers late, after the second one already finished
        await act(async () => {
            calls[0].resolve({ ok: false, kind: "network", message: "stale" });
            await first;
        });
        expect(result.current.state).toMatchObject({ status: "success" });
    });

    it("does not show a cancelled request as an error", async () => {
        const { submit, calls } = controllable();
        const { result } = renderHook(() => useLookup(submit));

        let run!: Promise<void>;
        act(() => {
            run = result.current.run("x");
        });
        act(() => {
            void result.current.run("y"); // aborts "x"
        });
        await act(async () => {
            calls[0].resolve({ ok: false, kind: "aborted", message: "cancelled" });
            await run;
        });
        expect(result.current.state).toEqual({ status: "loading", input: "y" });
    });

    it("cancels the lookup in flight when the component goes away", () => {
        const { submit, calls } = controllable();
        const { result, unmount } = renderHook(() => useLookup(submit));
        act(() => {
            void result.current.run("x");
        });
        unmount();
        expect(calls[0].signal.aborted).toBe(true);
    });
});
