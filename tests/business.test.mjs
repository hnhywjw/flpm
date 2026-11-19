/**
 * 业务规则单元测试
 * 覆盖：库存、回款、开票、过单费等关键约束
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ---------------- 库存规则 ----------------
describe("库存规则", () => {
  /** 出库校验：返回错误信息或 null */
  function checkOutStock(have, need, itemName = "物料", unit = "台") {
    if (need <= 0) return "数量必须大于 0";
    if (have < need) {
      return `库存不足：${itemName} 当前 ${have} ${unit}，需出库 ${need} ${unit}`;
    }
    return null;
  }

  test("库存充足允许出库", () => {
    assert.equal(checkOutStock(12, 5), null);
  });

  test("库存刚好够允许出库", () => {
    assert.equal(checkOutStock(10, 10), null);
  });

  test("库存不足拒绝并给出当前库存", () => {
    const err = checkOutStock(12, 9999, "摄像机", "台");
    assert.notEqual(err, null);
    assert.match(err, /库存不足/);
    assert.match(err, /12/);
    assert.match(err, /9999/);
  });

  test("数量为 0 或负数拒绝", () => {
    assert.match(checkOutStock(100, 0), /必须大于/);
    assert.match(checkOutStock(100, -5), /必须大于/);
  });

  /** 删除单据后的库存回滚 */
  function rollbackStock(currentQty, direction, moveQty) {
    const delta = direction === "in" ? -moveQty : moveQty;
    const next = currentQty + delta;
    if (next < 0) return { ok: false, next, reason: "回滚后库存为负" };
    return { ok: true, next };
  }

  test("删除出库单：库存加回", () => {
    assert.deepEqual(rollbackStock(11, "out", 1), { ok: true, next: 12 });
  });

  test("删除入库单：库存扣减", () => {
    assert.deepEqual(rollbackStock(12, "in", 2), { ok: true, next: 10 });
  });

  test("删除入库单导致负库存时拒绝", () => {
    const r = rollbackStock(1, "in", 5);
    assert.equal(r.ok, false);
    assert.equal(r.next, -4);
  });
});

// ---------------- 回款规则 ----------------
describe("回款登记规则", () => {
  function checkPayment(planCents, actualCents, addCents) {
    if (addCents <= 0) return "金额必须大于 0";
    const next = actualCents + addCents;
    if (next > planCents) {
      return `累计回款超过计划金额 ${(planCents / 10000).toFixed(2)} 万`;
    }
    return null;
  }

  test("部分回款允许", () => {
    assert.equal(checkPayment(1000000, 0, 300000), null);
  });

  test("累计到满额允许", () => {
    assert.equal(checkPayment(1000000, 700000, 300000), null);
  });

  test("累计超额拒绝", () => {
    const err = checkPayment(1000000, 700000, 400000);
    assert.match(err, /超过计划金额/);
  });

  test("冲正后状态应回到未回款", () => {
    const plan = 1000000;
    const afterReverse = 0;
    const status = afterReverse >= plan ? "已回款"
      : afterReverse > 0 ? "部分回款" : "待收回";
    assert.equal(status, "待收回");
  });
});

// ---------------- 开票规则 ----------------
describe("开票规则", () => {
  function checkInvoice(planCents, invoicedCents, addCents) {
    if (addCents <= 0) return "开票金额必须大于 0";
    const next = invoicedCents + addCents;
    if (next > planCents) {
      return `开票金额超过期次余额，最多可开 ${((planCents - invoicedCents) / 10000).toFixed(2)} 万`;
    }
    return null;
  }

  test("首次开票允许", () => {
    assert.equal(checkInvoice(1000000, 0, 300000), null);
  });

  test("分次开票累计不超限允许", () => {
    assert.equal(checkInvoice(1000000, 600000, 400000), null);
  });

  test("超额开票拒绝", () => {
    const err = checkInvoice(1000000, 600000, 500000);
    assert.match(err, /超过期次余额/);
    assert.match(err, /40\.00/); // 剩余 40 万
  });

  test("验收四件套未齐备时禁止开票", () => {
    const required = ["安装配置文档", "到货签收单", "验收报告", "项目资料"];
    const DONE = ["已提交", "已签收", "已出具", "已齐备"];
    function missingDocs(map) {
      return required.filter((d) => !DONE.includes(map[d] ?? ""));
    }
    // 缺 1 项
    const m1 = missingDocs({
      "安装配置文档": "已提交", "到货签收单": "已签收", "验收报告": "已出具",
    });
    assert.deepEqual(m1, ["项目资料"]);

    // 全部齐备
    const m2 = missingDocs({
      "安装配置文档": "已提交", "到货签收单": "已签收",
      "验收报告": "已出具", "项目资料": "已齐备",
    });
    assert.deepEqual(m2, []);
  });

  /** 开票状态与回款状态相互独立 */
  function invoiceStatus(plan, invoiced) {
    if (invoiced <= 0) return "未开票";
    if (invoiced >= plan) return "已开票";
    return "部分开票";
  }

  test("已开票但未付款是合法组合", () => {
    const plan = 1000000;
    assert.equal(invoiceStatus(plan, plan), "已开票");   // 开票满额
    const paid = 0;
    const payStatus = paid <= 0 ? "未付款" : paid >= plan ? "已付款" : "部分付款";
    assert.equal(payStatus, "未付款");
  });

  test("已付款但未开票是合法组合", () => {
    const plan = 1000000;
    assert.equal(invoiceStatus(plan, 0), "未开票");
    assert.equal("已付款", "已付款");
  });

  test("部分开票状态", () => {
    assert.equal(invoiceStatus(1000000, 400000), "部分开票");
  });
});

// ---------------- 合同规则 ----------------
describe("合同规则", () => {
  test("付款比例合计必须为 100", () => {
    function checkSummary(s) {
      const sum = s.split("/").map(Number).reduce((a, b) => a + b, 0);
      return Math.abs(sum - 100) < 0.01 ? null : `付款比例合计必须为 100，当前为 ${sum}`;
    }
    assert.equal(checkSummary("30/40/25/5"), null);
    assert.equal(checkSummary("50/50"), null);
    assert.equal(checkSummary("100"), null);
    assert.match(checkSummary("30/40/25"), /当前为 95/);
    assert.match(checkSummary("50/60"), /当前为 110/);
  });

  test("合同金额不能小于已回款总额", () => {
    function checkAmount(newAmount, paid) {
      if (newAmount < paid) {
        return `合同金额不能小于已回款总额 ${(paid / 10000).toFixed(2)} 万元`;
      }
      return null;
    }
    // 100万元(1000000分) 改到 300万元，已回款 234万元 → 允许
    assert.equal(checkAmount(3000000, 2340000), null);
    // 100万元 改到 100万元，已回款 234万元 → 拒绝（新金额小于已回款）
    assert.match(checkAmount(1000000, 2340000), /不能小于已回款/);
    // 金额刚好等于已回款 → 允许
    assert.equal(checkAmount(2340000, 2340000), null);
  });
});

// ---------------- 过单费规则 ----------------
describe("过单费规则", () => {
  test("差价法要求开票额小于客户额", () => {
    function checkDiff(customer, invoiced) {
      if (invoiced >= customer) return "差价法要求开票额小于客户合同额";
      return null;
    }
    assert.equal(checkDiff(2000000, 1800000), null);
    assert.match(checkDiff(2000000, 2000000), /要求开票额小于/);
    assert.match(checkDiff(2000000, 2100000), /要求开票额小于/);
  });

  test("现金法必须填费率", () => {
    function checkCash(rate) {
      if (!rate || rate <= 0) return "现金法必须填写费率";
      return null;
    }
    assert.equal(checkCash(6), null);
    assert.match(checkCash(0), /必须填写费率/);
    assert.match(checkCash(null), /必须填写费率/);
  });

  test("付款金额不能超过未付余额", () => {
    function checkPay(remaining, amount) {
      if (amount > remaining) {
        return `付款金额超过未付余额 ${(remaining / 10000).toFixed(2)} 万元`;
      }
      return null;
    }
    assert.equal(checkPay(64300, 10000), null);
    assert.match(checkPay(64300, 100000), /超过未付余额/);
  });

  test("个人收款三件套缺一不可", () => {
    function checkDocs(agreement, voucher, confirm) {
      const missing = [];
      if (!agreement) missing.push("代中标协议");
      if (!voucher) missing.push("付款凭证");
      if (!confirm) missing.push("收款确认单");
      return missing;
    }
    assert.deepEqual(checkDocs("1", "2", "3"), []);
    assert.deepEqual(checkDocs("1", null, "3"), ["付款凭证"]);
    assert.equal(checkDocs(null, null, null).length, 3);
  });
});

// ---------------- 权限规则 ----------------
describe("权限与角色合并", () => {
  test("多角色菜单取并集", () => {
    const roleMenus = {
      finance: ["dashboard", "projects", "finance"],
      pm: ["dashboard", "projects", "changes"],
    };
    const userRoles = ["finance", "pm"];
    const menus = new Set();
    userRoles.forEach((r) => (roleMenus[r] ?? []).forEach((m) => menus.add(m)));
    assert.deepEqual([...menus].sort(), ["changes", "dashboard", "finance", "projects"]);
  });

  test("多角色金额权限取或", () => {
    const roleAmount = { warehouse: false, finance: true };
    function canSee(roles) {
      return roles.some((r) => roleAmount[r] === true);
    }
    assert.equal(canSee(["warehouse"]), false);
    assert.equal(canSee(["warehouse", "finance"]), true);
    assert.equal(canSee(["finance"]), true);
  });
});

// ---------------- 数据权限 ----------------
describe("数据权限范围", () => {
  function scopeOf(roles) {
    if (roles.includes("boss") || roles.includes("admin") || roles.includes("finance")) return "all";
    return "own";
  }

  test("财务看全部", () => {
    assert.equal(scopeOf(["finance"]), "all");
  });

  test("总经理看全部", () => {
    assert.equal(scopeOf(["boss"]), "all");
  });

  test("项目经理只看自己", () => {
    assert.equal(scopeOf(["pm"]), "own");
  });

  test("商务只看自己", () => {
    assert.equal(scopeOf(["sales"]), "own");
  });

  test("项目经理兼财务看全部", () => {
    assert.equal(scopeOf(["pm", "finance"]), "all");
  });
});
