import { one } from "./db";
import type { SessionUser } from "./auth";
import { canAccessProject } from "./scope";

/**
 * 附件访问控制
 *
 * ★ 这里原先完全没有校验，是审计发现的高危漏洞：
 *
 *   列表 GET /api/attachments?entityType=project&entityId=1
 *   下载 GET /api/attachments/download?id=123
 *   两者都只调用了 requireUser()，也就是「登录了就能看」。
 *   任何销售账号遍历 id，就能下载全公司的合同、发票、验收单。
 *
 * 现在按附件挂靠的业务实体反查权限：
 *   一律先定位到「所属项目」，再走项目数据权限
 *   （本人负责 / 商务可见 / 管理层全看）。
 */

/**
 * 允许上传/读取附件的实体类型
 *
 * ★ 新增类型必须同时：
 *   1. 加进这个数组
 *   2. 在 resolveProjectId() 里写清楚怎么反查到项目
 * 否则默认拒绝 —— 这是防止「新增业务忘配权限」导致越权的关键。
 */
export const ATTACHMENT_ENTITY_TYPES = [
  "project",            // 项目综合附件
  "bid",                // 招标项目层级：招标文件、中标通知书
  "bid_participant",    // 单个投标人的投标文件
  "award",              // 中标通知书（兼容旧数据）
  "contract",           // 客户合同 / 采购合同扫描件
  "implementation",     // 实施方案
  "acceptance",         // 验收资料（四件套）
  "invoice",            // 发票扫描件
  "payment",            // 回款 / 付款凭证
  "agent_fee_payment",  // 过单费付款凭证（原有）
] as const;

export type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number];

export function isValidEntityType(t: string): t is AttachmentEntityType {
  return (ATTACHMENT_ENTITY_TYPES as readonly string[]).includes(t);
}

/**
 * 从「业务实体」反查所属项目 id
 *
 * 返回 null 表示：查不到 / 该实体本身不挂项目。
 * 调用方据此决定是拒绝，还是走「非项目类」的兜底权限。
 */
/**
 * 投标类实体的「负责人」
 *
 * ★ 为什么不能只看 project_id
 *
 * 招标阶段 bids.project_id 通常是空的 —— 项目还没中标、还没立项。
 * 如果只靠 project_id 反查，销售在招标阶段就传不了自己的投标文件，
 * 而这恰恰是最需要上传的时候。
 *
 * 所以投标类（bid / award / bid_participant）额外按 owner_id 判归属：
 *   负责人本人 → 可以操作
 *   其他人     → 走项目权限 / 管理层兜底
 */
function bidOwnerOf(entityType: string, entityId: number): number | null {
  switch (entityType) {
    case "bid":
    case "award": {
      const r = one<{ owner_id: number | null }>(
        "SELECT owner_id FROM bids WHERE id = ? AND deleted_at IS NULL", [entityId]
      );
      return r?.owner_id ?? null;
    }
    case "bid_participant": {
      const r = one<{ owner_id: number | null }>(
        `SELECT b.owner_id
         FROM bid_participants p JOIN bids b ON b.id = p.bid_id
         WHERE p.id = ?`, [entityId]
      );
      return r?.owner_id ?? null;
    }
    default:
      return null;
  }
}

function resolveProjectId(entityType: string, entityId: number): number | null {
  switch (entityType) {
    case "project":
      return entityId;

    case "bid":
    case "award": {
      // 投标表 bids，中标后回填 project_id
      const r = one<{ project_id: number | null }>(
        "SELECT project_id FROM bids WHERE id = ? AND deleted_at IS NULL", [entityId]
      );
      return r?.project_id ?? null;
    }

    case "bid_participant": {
      // 单个投标人 → 所属投标项目 → 项目
      //
      // bid_participants.bid_id 是必填外键，所以这里一定有值；
      // 但 bids.project_id 可能为空（还没中标、没建项目），
      // 这时返回 null，由调用方按「非项目类」兜底（管理层/财务可见）。
      const r = one<{ project_id: number | null }>(
        `SELECT b.project_id
         FROM bid_participants p JOIN bids b ON b.id = p.bid_id
         WHERE p.id = ?`, [entityId]
      );
      return r?.project_id ?? null;
    }

    case "contract": {
      const r = one<{ project_id: number | null }>(
        "SELECT project_id FROM contracts WHERE id = ? AND deleted_at IS NULL", [entityId]
      );
      return r?.project_id ?? null;
    }

    case "implementation":
    case "acceptance": {
      // 验收资料表：project_id 是必填
      const r = one<{ project_id: number | null }>(
        "SELECT project_id FROM acceptances WHERE id = ? AND deleted_at IS NULL", [entityId]
      );
      return r?.project_id ?? null;
    }

    case "invoice": {
      const r = one<{ project_id: number | null }>(
        "SELECT project_id FROM invoices WHERE id = ?", [entityId]
      );
      return r?.project_id ?? null;
    }

    case "payment": {
      // 回款期次 → 合同 → 项目
      const r = one<{ project_id: number | null }>(
        `SELECT c.project_id
         FROM payment_terms t JOIN contracts c ON c.id = t.contract_id
         WHERE t.id = ? AND t.deleted_at IS NULL`, [entityId]
      );
      return r?.project_id ?? null;
    }

    case "agent_fee_payment": {
      const r = one<{ project_id: number | null }>(
        `SELECT a.project_id
         FROM agent_fee_payments p JOIN agent_agreements a ON a.id = p.agreement_id
         WHERE p.id = ? AND p.deleted_at IS NULL`, [entityId]
      );
      return r?.project_id ?? null;
    }

    default:
      return null;
  }
}

/** 管理层 / 财务：不受项目归属限制 */
function isBroadScope(user: SessionUser): boolean {
  return (
    user.roles.includes("boss") ||
    user.roles.includes("admin") ||
    user.roles.includes("finance")
  );
}

/**
 * 判断用户能否访问某个业务实体下的附件
 */
export function canAccessEntity(
  user: SessionUser,
  entityType: string,
  entityId: number
): boolean {
  if (!Number.isFinite(entityId) || entityId <= 0) return false;
  if (!isValidEntityType(entityType)) return false;

  // 项目本体直接走项目权限
  if (entityType === "project") return canAccessProject(user, entityId);

  // 投标类：负责人本人可以直接操作（招标阶段往往还没有 project_id）
  const bidOwner = bidOwnerOf(entityType, entityId);
  if (bidOwner !== null && bidOwner === user.id) return true;

  const projectId = resolveProjectId(entityType, entityId);
  if (projectId) return canAccessProject(user, projectId);

  // 查不到所属项目时：
  //   管理层/财务放行（他们要能查看全部单据）
  //   其他人拒绝（默认安全）
  return isBroadScope(user);
}

/**
 * 判断用户能否访问某个具体附件
 *
 * 上传者本人始终可以访问自己传的文件；
 * 其余按附件归属的业务实体反查权限。
 */
export function canAccessAttachment(user: SessionUser, attachmentId: number): boolean {
  const row = one<{ entity_type: string; entity_id: number; uploaded_by: number }>(
    "SELECT entity_type, entity_id, uploaded_by FROM attachments WHERE id = ?",
    [attachmentId]
  );
  if (!row) return false;

  if (row.uploaded_by === user.id) return true;

  return canAccessEntity(user, row.entity_type, row.entity_id);
}

/**
 * 哪些实体类型需要「必须上传文件才算完成」
 * 目前只用于验收：四项齐备但没传文件，不允许推进开票
 */
export function requiresFile(entityType: string): boolean {
  return entityType === "acceptance";
}
