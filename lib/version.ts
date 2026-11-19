/**
 * 版本号单一来源
 *
 * 以前有三处不一致：
 *   package.json  -> 0.1.0
 *   Sidebar 底部   -> v0.3（写死）
 *   软件升级页     -> 读 package.json -> v0.1.0
 *
 * 现在统一从 package.json 读，UI 与升级页共用同一个值。
 * 发版时只改 package.json 的 version 字段。
 */
import pkg from "../package.json";

export const APP_VERSION: string = "v" + (pkg.version ?? "0.0.0");
export const APP_VERSION_RAW: string = pkg.version ?? "0.0.0";
