import type { CSSProperties, ReactNode } from "react";

/**
 * 侧栏 / 菜单图标
 *
 * 为什么用内联 SVG 而不是 Unicode 符号（▤ ▣ ◈ …）：
 *
 *   1. 语义 — 那些几何符号本身没有意义，用户只能靠位置记；
 *      同一组里 ▤ ▣ ▥ ▦ 长得几乎一样，根本分不清。
 *   2. 一致性 — Unicode 符号的粗细、大小、基线由字体决定，
 *      Windows / macOS / 手机 / 不同浏览器渲染都不一样。
 *   3. 可控 — SVG 用 currentColor，自动跟随主题色和选中态（白字）。
 *
 * 统一规格：24×24 viewBox、1.75px 描边、圆角端点、不填充。
 * 这套参数和 Lucide / Feather 一致，视觉上更"成套"。
 */

export type IconName =
  // 业务
  | "dashboard" | "projects" | "bidding" | "awards" | "contracts"
  | "finance" | "changes" | "inventory" | "service"
  // 协作
  | "approvals" | "alerts" | "reports"
  // 管理
  | "database" | "logs"
  // 系统
  | "system" | "load" | "services" | "upgrade" | "backup" | "config" | "reset";

const PATHS: Record<IconName, ReactNode> = {
  // 工作台 — 四宫格面板，典型的 dashboard 语义
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="8.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="5" rx="1.5" />
      <rect x="13.5" y="11" width="7.5" height="10" rx="1.5" />
      <rect x="3" y="14.5" width="7.5" height="6.5" rx="1.5" />
    </>
  ),

  // 项目管理 — 文件夹（多个项目的集合）
  projects: (
    <>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2a2 2 0 0 1 1.5.7l1 1.2h7.3A2.5 2.5 0 0 1 21 9.4v7.1a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-9z" />
    </>
  ),

  // 投标管理 — 纸飞机（投递标书）
  // 之前用「文档+箭头」，与合同管理太像；纸飞机在 17px 下轮廓依然清晰
  bidding: (
    <>
      <path d="M21 3.5 10.5 14" />
      <path d="M21 3.5 14.2 21l-3.7-7-7-3.7L21 3.5z" />
    </>
  ),

  // 中标管理 — 奖杯
  awards: (
    <>
      <path d="M8 21h8" />
      <path d="M12 17.5V21" />
      <path d="M7 4h10v5.5a5 5 0 0 1-10 0V4z" />
      <path d="M7 6.5H5.2a1.7 1.7 0 0 0 0 3.4H7" />
      <path d="M17 6.5h1.8a1.7 1.7 0 0 1 0 3.4H17" />
    </>
  ),

  // 合同管理 — 文档 + 签名（底部一条手写曲线）
  // 「签名」是合同最独特的视觉特征，和普通文档、票据都能区分开
  contracts: (
    <>
      <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" />
      <path d="M13.5 3v6h6" />
      <path d="M17.5 9 21 12.5l-5.6 5.6-2.9.5.5-2.9L18.6 10" />
      <path d="M8.5 13h3" />
      <path d="M8.5 17h2" />
    </>
  ),

  // 开票与回款 — 钱币 + 双向流动箭头
  // 圆币轮廓独树一帜，不会和任何文档类图标混淆
  finance: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v10" />
      <path d="M14.8 9.4c-.6-.9-1.6-1.4-2.8-1.4-1.7 0-3 .9-3 2.2 0 1.4 1.2 1.9 3 2.2 1.8.3 3 .8 3 2.2 0 1.3-1.3 2.2-3 2.2-1.2 0-2.2-.5-2.8-1.4" />
    </>
  ),

  // 变更与风险 — 分支（变更产生分支）
  changes: (
    <>
      <circle cx="6.5" cy="6" r="2.2" />
      <circle cx="6.5" cy="18" r="2.2" />
      <circle cx="17.5" cy="8" r="2.2" />
      <path d="M6.5 8.2v7.6" />
      <path d="M17.5 10.2c0 4.2-4.5 3.6-6.8 6.4" />
    </>
  ),

  // 出入库 — 立体包装箱
  inventory: (
    <>
      <path d="M21 8.2 12 3 3 8.2v7.6L12 21l9-5.2V8.2z" />
      <path d="M3 8.2 12 13.4l9-5.2" />
      <path d="M12 13.4V21" />
    </>
  ),

  // 售后服务 — 耳麦（客服）
  service: (
    <>
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
      <path d="M4 14h1.6a1 1 0 0 1 1 1v3.4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V14z" />
      <path d="M20 14h-1.6a1 1 0 0 0-1 1v3.4a1 1 0 0 0 1 1H19a1 1 0 0 0 1-1V14z" />
    </>
  ),

  // 审批中心 — 夹板 + 勾
  approvals: (
    <>
      <path d="M9 4.5h6a1 1 0 0 1 1 1V7H8V5.5a1 1 0 0 1 1-1z" />
      <path d="M8 7H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2" />
      <path d="M8.8 13.6 11 15.8l4.2-4.2" />
    </>
  ),

  // 待办预警 — 铃铛
  alerts: (
    <>
      <path d="M18 9a6 6 0 1 0-12 0c0 4.6-1.8 5.8-1.8 5.8h15.6S18 13.6 18 9z" />
      <path d="M13.7 18.5a2 2 0 0 1-3.4 0" />
    </>
  ),

  // 报表分析 — 柱状图
  reports: (
    <>
      <path d="M3.5 3.5v17h17" />
      <path d="M8 17.5v-5" />
      <path d="M12.5 17.5v-9" />
      <path d="M17 17.5v-12" />
    </>
  ),

  // 基础数据 — 数据库
  database: (
    <>
      <ellipse cx="12" cy="5.5" rx="8" ry="2.8" />
      <path d="M4 5.5v6.3c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8V5.5" />
      <path d="M4 11.8v6.3c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-6.3" />
    </>
  ),

  // 操作日志 — 列表（带项目符号）
  logs: (
    <>
      <path d="M9 6.5h11.5" />
      <path d="M9 12h11.5" />
      <path d="M9 17.5h11.5" />
      <circle cx="4.5" cy="6.5" r="1.1" />
      <circle cx="4.5" cy="12" r="1.1" />
      <circle cx="4.5" cy="17.5" r="1.1" />
    </>
  ),

  // 系统管理 — 分栏面板（左侧导航 + 右侧内容）
  // 不再用滑块，避开与「参数配置」的重叠
  system: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9.5 4v16" />
      <path d="M5.8 8.5h1.4M5.8 12h1.4M5.8 15.5h1.4" />
    </>
  ),

  // 系统负载 — 心跳线
  load: (
    <>
      <path d="M3 12.5h3.8l2.4-6.5 3.6 12.5 2.6-6h5.6" />
    </>
  ),

  // 服务状态 — 云 + 对勾（服务运行正常）
  // 原来用服务器机架，17px 时细节糊成一块；改成云的轮廓更干净
  services: (
    <>
      <path d="M7.5 18.5h9.2a3.8 3.8 0 0 0 .6-7.6 5.5 5.5 0 0 0-10.6-1.1 3.9 3.9 0 0 0 .8 8.7z" />
      <path d="M9.8 14.6 11.6 16.4l3-3.2" />
    </>
  ),

  // 软件升级 — 向上箭头 + 托盘
  upgrade: (
    <>
      <path d="M12 16V3.5" />
      <path d="M7.5 8 12 3.5 16.5 8" />
      <path d="M4 15.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </>
  ),

  // 数据备份 — 向下箭头 + 托盘（备份到本地）
  backup: (
    <>
      <path d="M12 3.5V16" />
      <path d="M7.5 11.5 12 16l4.5-4.5" />
      <path d="M4 15.5v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </>
  ),

  // 参数配置 — 旋钮（齿轮）
  // 原来用三条滑轨，与「系统管理」几乎一样；改成齿轮，语义也更准确
  config: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.6M12 18.6v2.6M4.7 4.7l1.8 1.8M17.5 17.5l1.8 1.8M2.8 12h2.6M18.6 12h2.6M4.7 19.3l1.8-1.8M17.5 6.5l1.8-1.8" />
    </>
  ),

  // 系统初始化 — 回转箭头
  reset: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.9-6.4" />
      <path d="M3.5 3.5v5h5" />
    </>
  ),
};

export function Icon({
  name,
  size = 17,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", flex: "0 0 auto", ...style }}
    >
      {PATHS[name]}
    </svg>
  );
}
