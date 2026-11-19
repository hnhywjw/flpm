import { guardPage } from "@/lib/page-guard";
import { PageHeader } from "@/components/ui";
import { InitPanel } from "./InitPanel";

export const dynamic = "force-dynamic";

export default async function InitPage() {
  await guardPage("system");
  return (
    <>
      <PageHeader
        title="系统初始化"
        desc="清空业务数据（保留账号与系统配置），用于新环境部署"
      />
      <InitPanel />
    </>
  );
}
