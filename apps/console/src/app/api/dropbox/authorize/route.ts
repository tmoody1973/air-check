import { authorizeHandler } from "@/lib/ingestRoutes";

// Connect dropbox from the Settings form (same-origin POST only). See src/lib/ingestRoutes.ts.
export const POST = authorizeHandler("dropbox");
