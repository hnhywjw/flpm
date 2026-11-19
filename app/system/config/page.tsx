import { guardPage } from "@/lib/page-guard";
import { PageHeader } from "@/components/ui";
import { all } from "@/lib/db";
import { ConfigPanel } from "./ConfigPanel";
import { CertPanel } from "./CertPanel";

export const dynamic = "force-dynamic";

export default async function ConfigPage() {
  await guardPage("system");

  let rows: {
    key: string; value: string;
    label: string | null; description: string | null; updated_at: string;
  }[] = [];
  try {
    rows = all(
      "SELECT key, value, label, description, updated_at FROM system_params ORDER BY key"
    );
  } catch {
    rows = [];
  }

  return (
    <>
      <PageHeader title="参数配置" desc={`共 ${rows.length} 项系统参数 · 含证书与登录超时`} />
      <CertPanel />
      <ConfigPanel initial={rows} />
    </>
  );
}
