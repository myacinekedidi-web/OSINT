// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import LookupPage, { metadata } from "@/app/lookup/page";

vi.mock("@/components/ui/toast", () => ({ toast: { add: vi.fn() } }));
afterEach(cleanup);

describe("/lookup page", () => {
    it("has exactly one h1, a main landmark and the lookup form", () => {
        render(<LookupPage />);
        expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
        expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Lookup");
        expect(screen.getByRole("main")).toBeTruthy();
        expect(screen.getByLabelText("What do you want to look up?")).toBeTruthy();
    });

    it("links back to the catalog", () => {
        render(<LookupPage />);
        expect(screen.getByRole("link", { name: /Tool catalog/ }).getAttribute("href")).toBe("/");
    });

    it("has its own title and description", () => {
        expect(metadata.title).toBe("Lookup");
        expect(String(metadata.description)).toContain("Nothing you enter is stored");
    });
});
