import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        // Same "@/..." alias as tsconfig.json, so component tests can import the UI primitives
        alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
    },
});
