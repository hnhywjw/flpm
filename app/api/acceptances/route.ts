import { NextRequest } from "next/server";
import { getProjectAcceptances, canAdvanceToInvoice } from "@/lib/queries";
import { run, audit } from "@/lib/db";
import { withAuth, withRole } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const projectId = Number(req.nextUrl.searchParams.get("projectId"));
  return withAuth(async () => ({
    acceptances: getProjectAcceptances(projectId),
    gate: canAdvanceToInvoice(projectId),
  }));
}

export async function POST(req: NextRequest) {
  return withRole(["pm", "boss", "sales"], async (user) => {
    const { projectId, docType, status, submitDate, filePath, note } = await req.json();
    if (!projectId || !docType) throw new Error("缺少参数");

    const exists = getProjectAcceptances(projectId).find((a) => a.doc_type === docType);
    if (exists) {
      run(
        "UPDATE acceptances SET status = ?, submit_date = COALESCE(?, submit_date), file_path = COALESCE(?, file_path), note = COALESCE(?, note) WHERE id = ?",
        [status, submitDate ?? null, filePath ?? null, note ?? null, exists.id]
      );
    } else {
      run(
        "INSERT INTO acceptances (project_id, doc_type, status, submit_date, owner_id, file_path, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [projectId, docType, status, submitDate ?? null, user.id, filePath ?? null, note ?? null]
      );
    }

    audit({
      userId: user.id, userName: user.name, action: "update",
      entityType: "acceptance", entityId: projectId,
      summary: `更新验收资料「${docType}」为 ${status}`,
    });

    return { ok: true, gate: canAdvanceToInvoice(projectId) };
  });
}
