/**
 * 金额遮蔽
 *
 * 背景：系统有「是否可见金额」的角色权限（roles.can_see_amount）。
 * 之前只有部分接口实现了遮蔽，导致库管角色能通过其他接口读到合同额、预算。
 *
 * 统一策略：不可见金额的角色，所有 *_cents 字段一律置 null，
 * 前端会显示「—」（区分「无数据」与「真 0」）。
 */

/** 所有需要遮蔽的金额字段后缀 */
const MONEY_SUFFIX = "_cents";

/**
 * 递归遮蔽对象里的金额字段
 * 处理嵌套对象与数组，返回新对象（不改原对象）
 */
export function maskAmounts<T>(data: T): T {
  if (data === null || data === undefined) return data;

  if (Array.isArray(data)) {
    return data.map((v) => maskAmounts(v)) as unknown as T;
  }

  if (typeof data === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (k.endsWith(MONEY_SUFFIX)) {
        out[k] = null;
      } else if (v !== null && typeof v === "object") {
        out[k] = maskAmounts(v);
      } else {
        out[k] = v;
      }
    }
    return out as T;
  }

  return data;
}

/**
 * 按权限返回数据：可看金额原样返回，否则遮蔽
 */
export function applyAmountMask<T>(data: T, canSeeAmount: boolean): T {
  if (canSeeAmount) return data;
  return maskAmounts(data);
}
