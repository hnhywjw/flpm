import { NextResponse } from "next/server";
import { buildAlerts } from "@/lib/queries";
import { requireUser, AuthError } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUser();
    return NextResponse.json({ count: buildAlerts().length });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ count: 0 });
  }
}
