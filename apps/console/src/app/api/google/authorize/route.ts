import { authorizeHandler } from "@/lib/ingestRoutes";

// Connect google from the Settings form (same-origin POST only). See src/lib/ingestRoutes.ts.
export const POST = authorizeHandler("google");
