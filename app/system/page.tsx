import { guardPage } from "@/lib/page-guard";
import { PageHeader } from "@/components/ui";
import { getLoadInfo, getServices } from "@/lib/sysinfo";
import { LoadPanel } from "./LoadPanel";

export const dynamic = "force-dynamic";

export default async function SystemPage() {
  await guardPage("system");

  const load = getLoadInfo();
  const services = getServices();

  return (
    <>
      <PageHeader
        title="系统负载"
        desc={`主机 ${load.host.hostname} · ${load.host.platform}/${load.host.arch} · 已运行 ${load.uptime.text}`}
      />
      <LoadPanel initial={load} initialServices={services} />
    </>
  );
}
