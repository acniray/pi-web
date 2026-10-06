import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  readNicobailonGlobalConcurrencyLimit,
  writeNicobailonGlobalConcurrencyLimit,
} from "@/lib/nicobailon-config";
import {
  readSubagentSettings,
  MAX_SUBAGENT_MAX_CONCURRENT,
  writeBuiltInSubagentsEnabled,
  writeSubagentBackend,
  writeSubagentMaxConcurrent,
} from "@/lib/subagent-settings";

export const dynamic = "force-dynamic";

function responseBody(settings: ReturnType<typeof readSubagentSettings>) {
  return {
    enabled: settings.backend !== "none",
    maxConcurrent: settings.backend === "nicobailon"
      ? readNicobailonGlobalConcurrencyLimit()
      : settings.maxConcurrent,
    backend: settings.backend,
  };
}

export async function GET() {
  try {
    return NextResponse.json(responseBody(readSubagentSettings()));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as { enabled?: unknown; maxConcurrent?: unknown; backend?: unknown };
    if (body.enabled === undefined && body.maxConcurrent === undefined && body.backend === undefined) {
      return NextResponse.json({ error: "enabled, maxConcurrent or backend is required" }, { status: 400 });
    }
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    if (body.backend !== undefined
      && body.backend !== "none"
      && body.backend !== "builtin"
      && body.backend !== "nicobailon") {
      return NextResponse.json({ error: "backend must be none, builtin or nicobailon" }, { status: 400 });
    }

    const current = readSubagentSettings();
    const requestedBackend = body.backend === "none" || body.backend === "builtin" || body.backend === "nicobailon"
      ? body.backend
      : body.enabled !== undefined
        ? body.enabled ? "builtin" : "none"
        : current.backend;

    // Validate the whole mutation before writing either settings file.
    if (body.maxConcurrent !== undefined) {
      if (typeof body.maxConcurrent !== "number" || !Number.isSafeInteger(body.maxConcurrent) || body.maxConcurrent < 1) {
        return NextResponse.json({ error: "maxConcurrent must be a positive safe integer" }, { status: 400 });
      }
      if (requestedBackend === "none") {
        return NextResponse.json({ error: "maxConcurrent requires an enabled subagent backend" }, { status: 400 });
      }
      if (requestedBackend === "builtin" && body.maxConcurrent > MAX_SUBAGENT_MAX_CONCURRENT) {
        return NextResponse.json(
          { error: `maxConcurrent must be an integer between 1 and ${MAX_SUBAGENT_MAX_CONCURRENT} for the Pi Web backend` },
          { status: 400 },
        );
      }
    }

    let settings = current;
    // Keep the old enabled mutation working, but make backend the source of truth.
    if (body.enabled !== undefined && body.backend === undefined) {
      settings = writeBuiltInSubagentsEnabled(body.enabled);
    }
    if (body.backend !== undefined) settings = writeSubagentBackend(body.backend);

    if (body.maxConcurrent !== undefined) {
      if (requestedBackend === "builtin") settings = writeSubagentMaxConcurrent(body.maxConcurrent);
      else writeNicobailonGlobalConcurrencyLimit(body.maxConcurrent);
    }
    return NextResponse.json(responseBody(settings));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
