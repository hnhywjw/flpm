/**
 * 路由路径常量
 *
 * 单独成文件的原因：客户端组件需要这些常量（AppShell 判断要不要套外壳），
 * 但不能 import lib/page-guard.ts —— 那个文件依赖 node:crypto，
 * 一旦被客户端引入，打包会失败。
 *
 * 这里只放纯字符串，任何环境都能安全引用。
 */

/** 强制改密页 */
export const FORCE_CHANGE_PWD_PATH = "/force-change-password";

/** 登录页 */
export const LOGIN_PATH = "/login";
