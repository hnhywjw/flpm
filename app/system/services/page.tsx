import { guardPage } from "@/lib/page-guard";
import { PageHeader } from "@/components/ui";
import { getServices, getLoadInfo } from "@/lib/sysinfo";
import { ServiceTable } from "./ServiceTable";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  await guardPage("system");
  const services = getServices();
  const load = getLoadInfo();

  return (
    <>
      <PageHeader
        title="服务状态"
        desc={`${services.filter((s) => s.status === "ok").length} / ${services.length} 项服务正常 · 主机 ${load.host.hostname} · 每 15 秒自动刷新`}
      />
      <ServiceTable initial={services} />
    </>
  );
}
