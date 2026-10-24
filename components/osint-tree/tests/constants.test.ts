import { describe, expect, it } from "vitest";
import { CATEGORY_COUNT_RESERVE, LABEL_PADDING, NODE_BOX, NODE_BOX_CENTER_Y, NODE_WIDTHS, labelWidth, type NodeKind } from "../constants";

describe("labelWidth", () => {
    const kinds = Object.keys(NODE_WIDTHS) as NodeKind[];

    it("leaves a positive area for every kind of label", () => {
        for (const kind of kinds) expect(labelWidth(kind)).toBeGreaterThan(0);
    });

    it("pads both sides of the box", () => {
        expect(labelWidth("resource")).toBe(NODE_WIDTHS.resource - 2 * LABEL_PADDING);
        expect(labelWidth("root")).toBe(NODE_WIDTHS.root - 2 * LABEL_PADDING);
    });

    it("keeps room for the count badge in category boxes only", () => {
        expect(labelWidth("category")).toBe(NODE_WIDTHS.category - 2 * LABEL_PADDING - CATEGORY_COUNT_RESERVE);
    });
});

describe("NODE_BOX", () => {
    it("centers labels vertically in the box", () => {
        expect(NODE_BOX_CENTER_Y).toBe(NODE_BOX.top + NODE_BOX.height / 2);
    });
});
