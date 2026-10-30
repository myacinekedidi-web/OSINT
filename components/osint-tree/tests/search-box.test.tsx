// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchBox } from "../search-box";

afterEach(cleanup);

/** Stands in for OsintTree: owns the raw query and shows it so tests can read it. */
function Harness({ initial = "" }: { initial?: string }) {
    const [value, setValue] = useState(initial);
    return (
        <>
            <SearchBox value={value} onChange={setValue} describedBy="status" />
            <output data-testid="raw">{value}</output>
        </>
    );
}

const input = () => screen.getByRole("combobox", { name: "Search OSINT resources" }) as HTMLInputElement;
const raw = () => screen.getByTestId("raw").textContent;
const chip = () => document.querySelector('[data-slot="favorites-chip"]');
const listbox = () => screen.queryByRole("listbox");

describe("SearchBox suggestions", () => {
    it("suggests @favorites as soon as the user types @", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        expect(listbox()).toBeNull();

        await user.type(input(), "@");

        expect(listbox()).not.toBeNull();
        expect(screen.getByRole("option").textContent).toContain("@favorites");
    });

    it("keeps suggesting while the token is partly typed, in any case", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await user.type(input(), "@FAV");
        expect(listbox()).not.toBeNull();
    });

    it("does not suggest for ordinary text or a wrong token", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await user.type(input(), "shodan");
        expect(listbox()).toBeNull();

        await user.clear(input());
        await user.type(input(), "@x");
        expect(listbox()).toBeNull();
    });

    it("exposes the combobox state to assistive technology", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        expect(input().getAttribute("aria-expanded")).toBe("false");
        expect(input().getAttribute("aria-describedby")).toBe("status");

        await user.type(input(), "@");

        expect(input().getAttribute("aria-expanded")).toBe("true");
        expect(input().getAttribute("aria-controls")).toBe(listbox()!.id);
        expect(input().getAttribute("aria-activedescendant")).toBe(screen.getByRole("option").id);
    });
});

describe("accepting the suggestion", () => {
    it("Enter turns it into a chip and empties the text box", async () => {
        const user = userEvent.setup();
        render(<Harness />);

        await user.type(input(), "@fa{Enter}");

        expect(raw()).toBe("@favorites ");
        expect(chip()?.textContent).toContain("@favorites");
        expect(input().value).toBe("");
        expect(listbox()).toBeNull();
        expect(document.activeElement).toBe(input());
    });

    it("clicking the suggestion does the same and keeps focus in the input", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await user.type(input(), "@");

        await user.click(screen.getByRole("option"));

        expect(raw()).toBe("@favorites ");
        expect(chip()).not.toBeNull();
        expect(document.activeElement).toBe(input());
    });

    it("typing the full token by hand also becomes a chip", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await user.type(input(), "@favorites");
        expect(chip()).not.toBeNull();
        expect(input().value).toBe("");
    });

    it("lets the user keep typing after the chip", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await user.type(input(), "@{Enter}shodan");
        expect(raw()).toBe("@favorites shodan");
        expect(input().value).toBe("shodan");
    });

    it("shows the chip and the remaining text for a query typed with the token", () => {
        render(<Harness initial="@favorites shodan" />);
        expect(chip()).not.toBeNull();
        expect(input().value).toBe("shodan");
    });
});

describe("dismissing and removing", () => {
    it("Escape closes the suggestion, and typing brings it back", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await user.type(input(), "@");

        await user.keyboard("{Escape}");
        expect(listbox()).toBeNull();
        expect(raw()).toBe("@");

        await user.keyboard("f");
        expect(listbox()).not.toBeNull();
    });

    it("closes the suggestion when the input loses focus", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await user.type(input(), "@");
        await user.tab(); // moves to the clear button
        expect(listbox()).toBeNull();
    });

    it("Backspace in an empty text box removes the chip", async () => {
        const user = userEvent.setup();
        render(<Harness initial="@favorites " />);
        await user.click(input());

        await user.keyboard("{Backspace}");

        expect(chip()).toBeNull();
        expect(raw()).toBe("");
    });

    it("Backspace with text only deletes a character and keeps the chip", async () => {
        const user = userEvent.setup();
        render(<Harness initial="@favorites ab" />);
        await user.click(input());
        await user.keyboard("{End}{Backspace}");
        expect(raw()).toBe("@favorites a");
        expect(chip()).not.toBeNull();
    });

    it("the chip's remove button removes the filter but keeps the text", async () => {
        const user = userEvent.setup();
        render(<Harness initial="@favorites shodan" />);

        await user.click(screen.getByRole("button", { name: "Remove favorites filter" }));

        expect(chip()).toBeNull();
        expect(raw()).toBe("shodan");
        expect(input().value).toBe("shodan");
    });

    it("the clear button empties everything, and only exists when there is something to clear", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();

        await user.type(input(), "abc");
        await user.click(screen.getByRole("button", { name: "Clear search" }));

        expect(raw()).toBe("");
        expect(input().value).toBe("");
        expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    });
});
