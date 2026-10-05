import { NextResponse } from "next/server";
import { listNicobailonChildSessions } from "@/lib/nicobailon-subagents";
import { resolveSessionPath } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const parentSessionPath = await resolveSessionPath(id);
    if (!parentSessionPath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json({
      sessions: await listNicobailonChildSessions(id, parentSessionPath),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
