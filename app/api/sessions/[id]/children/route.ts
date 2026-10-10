import { NextResponse } from "next/server";
import { listSessionChildren } from "@/lib/session-children";
import { resolveSessionPath } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const path = await resolveSessionPath(id);
  if (!path) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  try {
    return NextResponse.json({ sessions: await listSessionChildren(id, path) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to read session children" }, { status: 500 });
  }
}
