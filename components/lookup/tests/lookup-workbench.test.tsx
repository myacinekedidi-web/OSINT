// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LookupOutcome, SubmitFn } from "../../../lib/lookup/client";
import { SOURCE_INFO } from "../../../lib/lookup/labels";
import { sampleReport } from "../../../lib/lookup/tests/fixtures";
import { LookupWorkbench } from "../lookup-workbench";

vi.mock("@/components/ui/toast", () => ({ toast: { add: vi.fn() } }));
afterEach(cleanup);

const ok: LookupOutcome = { ok: true, report: sampleReport() };

const makeSubmit = (outcome: LookupOutcome = ok) => vi.fn<SubmitFn>(async () => outcome);

const input = () => screen.getByLabelText("What do you want to look up?") as HTMLInputElement;
const button = () => screen.getByRole("button", { name: /Look up|Looking up/ }) as HTMLButtonElement;
const hint = () => document.getElementById(input().getAttribute("aria-describedby")!)!;

/** A submit function that stays pending until the test resolves it. */
function pending() {
    let resolve!: (outcome: LookupOutcome) => void;
    const submit = vi.fn<SubmitFn>(() => new Promise<LookupOutcome>((r) => (resolve = r)));
    return { submit, finish: (outcome: LookupOutcome = ok) => resolve(outcome) };
}

describe("the form", () => {
    it("has a labelled input and a submit button that waits for input", () => {
        render(<LookupWorkbench submit={makeSubmit()} />);
        expect(input()).toBeTruthy();
        expect(button().disabled).toBe(true);
    });

    it("shows the live detection result while typing, without sending anything", async () => {
        const user = userEvent.setup();
        const submit = makeSubmit();
        render(<LookupWorkbench submit={submit} />);
        expect(hint().textContent).toContain("Enter an IP address");

        await user.type(input(), "8.8.8.8");
        expect(hint().textContent).toBe("Detected: IPv4 address");
        expect(button().disabled).toBe(false);

        await user.clear(input());
        await user.type(input(), "example.com/login");
        expect(hint().textContent).toContain("Detected: URL");
        expect(hint().textContent).toContain("assumed https://");

        await user.clear(input());
        await user.type(input(), "name@example.com");
        expect(hint().textContent).toBe("Detected: Email address");

        expect(submit).not.toHaveBeenCalled();
    });

    it("explains a bad input quietly while typing, and loudly after a submit attempt", async () => {
        const user = userEvent.setup();
        const submit = makeSubmit();
        render(<LookupWorkbench submit={submit} />);

        await user.type(input(), "10.0.0.1");
        expect(hint().textContent).toContain("private, reserved");
        expect(hint().className).not.toContain("text-destructive");
        expect(input().getAttribute("aria-invalid")).toBeNull();

        await user.click(button());
        expect(submit).not.toHaveBeenCalled();
        expect(hint().className).toContain("text-destructive");
        expect(input().getAttribute("aria-invalid")).toBe("true");
        expect(document.activeElement).toBe(input());

        await user.type(input(), "0"); // editing clears the complaint
        expect(input().getAttribute("aria-invalid")).toBeNull();
    });

    it("submits the text with the Enter key too", async () => {
        const user = userEvent.setup();
        const submit = makeSubmit();
        render(<LookupWorkbench submit={submit} />);
        await user.type(input(), "8.8.8.8{Enter}");
        expect(submit).toHaveBeenCalledOnce();
        expect(submit.mock.calls[0][0]).toBe("8.8.8.8");
    });
});

describe("running a lookup", () => {
    it("shows progress, then the report, and moves focus to it", async () => {
        const user = userEvent.setup();
        const { submit, finish } = pending();
        render(<LookupWorkbench submit={submit} />);

        await user.type(input(), "8.8.8.8");
        await user.click(button());

        expect(submit).toHaveBeenCalledOnce();
        expect(button().textContent).toContain("Looking up");
        expect(button().disabled).toBe(true);
        expect(screen.getByRole("status").textContent).toBe("Looking up…");
        expect(screen.queryByRole("heading", { name: "Report" })).toBeNull();

        finish();
        const heading = await screen.findByRole("heading", { level: 2, name: "Report" });
        expect(document.activeElement).toBe(heading);
        expect(button().textContent).toContain("Look up");
        expect(button().disabled).toBe(false);
        expect(screen.getByRole("status").textContent).toBe("Report ready. 3 findings from 1 source.");
    });

    it("marks the form busy while a lookup runs", async () => {
        const user = userEvent.setup();
        const { submit, finish } = pending();
        const { container } = render(<LookupWorkbench submit={submit} />);
        const form = container.querySelector("form")!;
        expect(form.getAttribute("aria-busy")).toBe("false");

        await user.type(input(), "8.8.8.8{Enter}");
        expect(form.getAttribute("aria-busy")).toBe("true");

        finish();
        await screen.findByRole("heading", { level: 2, name: "Report" });
        expect(form.getAttribute("aria-busy")).toBe("false");
    });

    it("does not start a second lookup while one is running", async () => {
        const user = userEvent.setup();
        const { submit } = pending();
        render(<LookupWorkbench submit={submit} />);

        await user.type(input(), "8.8.8.8{Enter}");
        await user.type(input(), "{Enter}{Enter}");
        expect(submit).toHaveBeenCalledOnce();
    });

    it("shows a failure as an alert and no report", async () => {
        const user = userEvent.setup();
        const submit = makeSubmit({ ok: false, kind: "rate_limited", message: "Too many lookups in a short time." });
        render(<LookupWorkbench submit={submit} />);

        await user.type(input(), "8.8.8.8{Enter}");

        const alert = await screen.findByRole("alert");
        expect(alert.textContent).toContain("Too many lookups in a short time.");
        expect(screen.queryByRole("heading", { name: "Report" })).toBeNull();
        expect(button().disabled).toBe(false); // the user can retry
    });

    it("stays quiet about a cancelled request", async () => {
        const user = userEvent.setup();
        render(<LookupWorkbench submit={makeSubmit({ ok: false, kind: "aborted", message: "cancelled" })} />);
        await user.type(input(), "8.8.8.8{Enter}");
        await waitFor(() => expect(button().disabled).toBe(false));
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("replaces the previous report with the next one", async () => {
        const user = userEvent.setup();
        const second = sampleReport({ input: { kind: "ipv4", value: "1.1.1.1" }, sources: [] });
        const submit = vi.fn<SubmitFn>().mockResolvedValueOnce(ok).mockResolvedValueOnce({ ok: true, report: second });
        render(<LookupWorkbench submit={submit} />);

        await user.type(input(), "8.8.8.8{Enter}");
        expect(await screen.findByText("3 findings from 1 source")).toBeTruthy();

        await user.clear(input());
        await user.type(input(), "1.1.1.1{Enter}");
        expect(await screen.findByText("No data sources cover this input yet")).toBeTruthy();
        expect(screen.queryByText("3 findings from 1 source")).toBeNull();
    });

    it("passes the router's notice through to the report", async () => {
        const user = userEvent.setup();
        render(<LookupWorkbench submit={makeSubmit({ ...ok, notice: "No scheme given: assumed https://" })} />);
        await user.type(input(), "example.com/x{Enter}");
        const matches = await screen.findAllByText(/assumed https:\/\//);
        expect(matches.length).toBeGreaterThanOrEqual(1);
    });
});

describe("transparency", () => {
    it("tells the user what happens to their input", () => {
        render(<LookupWorkbench submit={makeSubmit()} />);
        const note = screen.getByText(/does not store what you look up/);
        for (const source of Object.values(SOURCE_INFO)) {
            expect(note.textContent).toContain(source.name);
            expect(note.textContent).toContain(source.covers);
        }
        expect(screen.getByText(/Verify them independently/)).toBeTruthy();
    });
});
