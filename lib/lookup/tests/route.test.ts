import { describe, expect, it } from "vitest";
import { POST } from "../../../app/api/lookup/route";


describe("POST /api/lookup route", () => {
    it("is wired to the handler (a request without JSON is refused before any lookup)", async () => {
        const response = await POST(new Request("https://app.test/api/lookup", { method: "POST", body: "x" }));
        expect(response.status).toBe(415);
    });

    it("exports only the HTTP method Next.js allows", async () => {
        const routeModule = await import("../../../app/api/lookup/route");
        expect(Object.keys(routeModule)).toEqual(["POST"]);
    });
});
