import { handleLookup } from "@/lib/lookup/handler";

// Lookups are POST-only (inputs stay out of URLs, logs and history) and never cached.
// All logic lives in lib/lookup/handler.ts; Next.js route files may only export handlers.
export async function POST(request: Request) {
    return handleLookup(request);
}
