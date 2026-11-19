import { guardPage } from "@/lib/page-guard";
import { PageHeader } from "@/components/ui";
import { getVersionInfo } from "@/lib/sysinfo";
import { all } from "@/lib/db";
import { UpgradePanel } from "./UpgradePanel";

export const dynamic = "force-dynamic";

export default async function UpgradePage() {
  await guardPage("system");
  const v = getVersionInfo();

  let packages: {
    id: number; file_name: string; size_bytes: number;
    version: string | null; sha256: string | null; status: string;
    note: string | null; manifest: string | null;
    verify_ok: number | null; verify_errors: string | null;
    created_at: string;
  }[] = [];
  try {
    packages = all(
      `SELECT id, file_name, size_bytes, version, sha256, status, note,
              manifest, verify_ok, verify_errors, created_at
       FROM upgrade_packages ORDER BY id DESC LIMIT 50`
    );
  } catch {
    packages = [];
  }

  return (
    <>
      <PageHeader
        title="软件升级"
        desc="离线上传升级包 → 校验 → 下载升级脚本 → 服务器执行（带自动回滚）"
      />
      <UpgradePanel version={v} initialPackages={packages} />
    </>
  );
}
