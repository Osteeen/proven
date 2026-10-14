import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { maySeeCharityFiles } from "@/server/auth/access";
import { getDb } from "@/server/db/client";
import { proofFiles } from "@/server/db/schema";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

// A receipt image, for its own charity or a reviewer only. Anyone else gets the same
// "not found" as a missing file, so IDs reveal nothing.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return notFound();
  const [file] = await getDb()
    .select({ charityId: proofFiles.charityId, mime: proofFiles.mime, bytes: proofFiles.bytes })
    .from(proofFiles)
    .where(eq(proofFiles.proofId, id))
    .limit(1);
  if (!file || !(await maySeeCharityFiles(file.charityId))) return notFound();
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.mime,
      "Cache-Control": "private, no-store",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
