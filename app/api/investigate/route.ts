import { defaultDeps, errorResponse } from "@/lib/investigation/deps";
import { parseInvestigationInput } from "@/lib/investigation/input";
import { startInvestigation } from "@/lib/investigation/orchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  if (Number(request.headers.get("content-length") ?? 0) > 4096) {
    return Response.json({ error: "Request body too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  const parsed = parseInvestigationInput(body);
  if (!parsed.ok) return Response.json({ error: "Invalid input", fields: parsed.errors }, { status: 400 });

  try {
    const { investigation, reused } = await startInvestigation(defaultDeps(), parsed.value);
    return Response.json(
      { id: investigation.id, status: investigation.status, reused, poll_url: `/api/investigate/${investigation.id}` },
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error, "POST /api/investigate");
  }
}
