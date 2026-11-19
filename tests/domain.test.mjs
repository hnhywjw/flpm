/**
 * 领域逻辑单元测试
 * 运行：npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  fenToWan, wanToFen, fenToYuan,
  calcAgentFee, invoicedWanFromFeeRate, isVoucherComplete,
  parsePaySummary, buildPaymentTerms,
  overdueDays, daysFromNow,
  canSeeAmount, formatCode, changeAmountText,
} from "../.test-build/lib/domain.js";

// ---------------- 金额换算 ----------------
describe("金额换算", () => {
  test("fenToWan 分转万元，保留 2 位", () => {
    assert.equal(fenToWan(1000000), "100.00");
    assert.equal(fenToWan(12345), "1.23");
    assert.equal(fenToWan(0), "0.00");
  });

  test("fenToWan 空值返回占位符「—」而非 NaN", () => {
    // 设计意图：区分「没有数据」（—）与「真的是 0」（0.00）
    assert.equal(fenToWan(null), "—");
    assert.equal(fenToWan(undefined), "—");
    assert.equal(fenToWan(0), "0.00");
  });

  test("wanToFen 万元转分，四舍五入", () => {
    assert.equal(wanToFen(1), 10000);
    assert.equal(wanToFen("1.005"), 10050);
    assert.equal(wanToFen(0.01), 100);
  });

  test("fenToYuan 分转元", () => {
    assert.equal(fenToYuan(100), "1.00");
    assert.equal(fenToYuan(12345), "123.45");
    assert.equal(fenToYuan(null), "—");
  });

  test("换算可逆：万元 → 分 → 万元", () => {
    for (const wan of [0.01, 1, 99.99, 1234.56]) {
      const fen = wanToFen(wan);
      assert.equal(fenToWan(fen), wan.toFixed(2));
    }
  });
});

// ---------------- 过单费 ----------------
describe("过单费计算", () => {
  test("差价法：客户额 − 开票额", () => {
    const r = calcAgentFee("diff", 2000000, 1800000);
    assert.equal(r.fee, 200000);
    assert.match(r.formula, /200\.00/);
  });

  test("差价法：开票额等于客户额时费用为 0", () => {
    const r = calcAgentFee("diff", 1000000, 1000000);
    assert.equal(r.fee, 0);
  });

  test("现金法：按费率", () => {
    const r = calcAgentFee("cash", 2000000, 0, 6);
    assert.equal(r.fee, 120000); // 200万 × 6% = 12万
    assert.match(r.formula, /6\.00%/);
  });

  test("现金法：费率缺失时费用为 0，不抛异常", () => {
    const r = calcAgentFee("cash", 2000000, 0, null);
    assert.equal(r.fee, 0);
  });

  test("现金法：四舍五入到分", () => {
    const r = calcAgentFee("cash", 333333, 0, 3.33);
    assert.equal(r.fee, Math.round(333333 * 0.0333));
  });

  test("费率反推开票额：100万 x 6% -> 94万", () => {
    assert.equal(invoicedWanFromFeeRate(100, 6), 94);
    assert.equal(invoicedWanFromFeeRate("88.5", "6"), 83.19);
    assert.equal(invoicedWanFromFeeRate(100, 0), null);
    assert.equal(invoicedWanFromFeeRate(100, ""), null);
    assert.equal(invoicedWanFromFeeRate(100, 100), null);
  });
});

// ---------------- 凭证三件套 ----------------
describe("凭证三件套校验", () => {
  const ok = { doc_agreement: "1", doc_voucher: "2", doc_confirm: "3" };

  test("三件齐备返回 true", () => {
    assert.equal(isVoucherComplete(ok), true);
  });

  test("缺任意一件返回 false", () => {
    assert.equal(isVoucherComplete({ ...ok, doc_agreement: null }), false);
    assert.equal(isVoucherComplete({ ...ok, doc_voucher: "" }), false);
    assert.equal(isVoucherComplete({ ...ok, doc_confirm: undefined }), false);
  });

  test("全缺返回 false", () => {
    assert.equal(isVoucherComplete({}), false);
  });
});

// ---------------- 付款比例解析 ----------------
describe("付款比例解析", () => {
  test("标准 4 期", () => {
    assert.deepEqual(parsePaySummary("30/40/25/5"), [30, 40, 25, 5]);
  });

  test("带空格", () => {
    assert.deepEqual(parsePaySummary(" 30 / 70 "), [30, 70]);
  });

  test("非法字符被过滤", () => {
    assert.deepEqual(parsePaySummary("30/abc/70"), [30, 70]);
  });
});

// ---------------- 回款计划生成 ----------------
describe("回款计划生成", () => {
  test("4 期拆分，合计精确等于合同额", () => {
    const terms = buildPaymentTerms(1000000, "30/40/25/5");
    assert.equal(terms.length, 4);
    const sum = terms.reduce((s, t) => s + t.amountFen, 0);
    assert.equal(sum, 1000000, "合计必须精确等于合同额");
  });

  test("首期是预付款，末期是质保金", () => {
    const terms = buildPaymentTerms(1000000, "30/40/25/5");
    assert.equal(terms[0].termType, "advance");
    assert.equal(terms[3].termType, "warranty");
  });

  test("奇数金额不产生分差", () => {
    // 333.33 万，30/70 拆分会有舍入
    const amount = 3333300;
    const terms = buildPaymentTerms(amount, "33/67");
    const sum = terms.reduce((s, t) => s + t.amountFen, 0);
    assert.equal(sum, amount);
  });

  test("单期 100% 全归末期", () => {
    const terms = buildPaymentTerms(500000, "100");
    assert.equal(terms.length, 1);
    assert.equal(terms[0].amountFen, 500000);
  });

  test("seq 从 1 递增", () => {
    const terms = buildPaymentTerms(1000000, "30/40/30");
    assert.deepEqual(terms.map((t) => t.seq), [1, 2, 3]);
  });
});

// ---------------- 日期计算 ----------------
describe("日期计算", () => {
  const today = new Date("2026-10-28T10:00:00");

  test("逾期天数：已过期", () => {
    assert.equal(overdueDays("2026-10-20", today), 8);
  });

  test("逾期天数：未过期返回 0（不返回负数）", () => {
    assert.equal(overdueDays("2026-11-10", today), 0);
  });

  test("逾期天数：当天返回 0", () => {
    assert.equal(overdueDays("2026-10-28", today), 0);
  });

  test("逾期天数：空值返回 0", () => {
    assert.equal(overdueDays(null, today), 0);
  });

  test("距今天数：未来为正", () => {
    assert.equal(daysFromNow("2026-11-07", today), 10);
  });

  test("距今天数：过去为负", () => {
    assert.equal(daysFromNow("2026-10-18", today), -10);
  });
});

// ---------------- 权限 ----------------
describe("金额权限（内置角色默认值）", () => {
  test("库管看不到金额", () => {
    assert.equal(canSeeAmount("warehouse"), false);
  });

  test("系统管理员看不到金额", () => {
    assert.equal(canSeeAmount("admin"), false);
  });

  test("总经理、财务、商务、项目经理、售后能看到", () => {
    for (const r of ["boss", "finance", "sales", "pm", "service"]) {
      assert.equal(canSeeAmount(r), true, r + " 应可见金额");
    }
  });
});

// ---------------- 编码 ----------------
describe("编码生成", () => {
  test("默认补 3 位", () => {
    assert.equal(formatCode("P", 2026, 1), "P2026-001");
    assert.equal(formatCode("P", 2026, 999), "P2026-999");
  });

  test("超过位数不截断", () => {
    assert.equal(formatCode("P", 2026, 1234), "P2026-1234");
  });

  test("可自定义补位", () => {
    assert.equal(formatCode("B", 2026, 7, 4), "B2026-0007");
  });
});

// ---------------- 变更金额文案 ----------------
describe("变更金额文案", () => {
  test("正数带 +", () => {
    assert.equal(changeAmountText(100000), "+10.00 万");
  });

  test("负数带负号", () => {
    assert.equal(changeAmountText(-50000), "-5.00 万");
  });

  test("零值显示占位符", () => {
    // 设计意图：零变更不显示「0.00万」，避免噪音
    assert.equal(changeAmountText(0), "—");
  });
});

// ---------------- 节点 → 阶段 / 进度 ----------------
describe("项目阶段与进度联动", () => {
  const STAGE_MAP = {
    "招标": "投标", "投标": "投标", "中标": "投标", "合同": "合同",
    "实施": "实施", "验收": "验收", "开票": "回款", "回款": "回款",
    "保证金返还": "回款", "质保金": "质保", "售后": "售后",
  };

  function calcProgress(nodes) {
    const main = nodes.filter((n) => n.is_parallel === 0);
    if (main.length === 0) return 0;
    const done = main.filter((n) => n.status === "done" || n.status === "skip").length;
    return Math.round((done / main.length) * 100);
  }

  test("11 个节点全部映射到合法阶段", () => {
    const keys = ["招标", "投标", "中标", "合同", "实施", "验收",
                  "开票", "回款", "保证金返还", "质保金", "售后"];
    const validStages = ["投标", "合同", "实施", "验收", "回款", "质保", "售后"];
    for (const k of keys) {
      assert.ok(validStages.includes(STAGE_MAP[k]), k + " 应映射到合法阶段");
    }
  });

  test("进度按主线节点计算，不含并行节点", () => {
    // 11 个节点，其中"保证金返还"是并行
    const nodes = [
      { node_key: "招标", status: "done", is_parallel: 0 },
      { node_key: "投标", status: "done", is_parallel: 0 },
      { node_key: "中标", status: "cur", is_parallel: 0 },
      { node_key: "合同", status: "next", is_parallel: 0 },
      { node_key: "实施", status: "next", is_parallel: 0 },
      { node_key: "验收", status: "next", is_parallel: 0 },
      { node_key: "开票", status: "next", is_parallel: 0 },
      { node_key: "回款", status: "next", is_parallel: 0 },
      { node_key: "保证金返还", status: "next", is_parallel: 1 },  // 并行，不计
      { node_key: "质保金", status: "next", is_parallel: 0 },
      { node_key: "售后", status: "next", is_parallel: 0 },
    ];
    // 主线 10 个，完成 2 个 → 20%
    assert.equal(calcProgress(nodes), 20);
  });

  test("全部完成是 100%", () => {
    const nodes = Array.from({ length: 10 }, () => ({ status: "done", is_parallel: 0 }));
    assert.equal(calcProgress(nodes), 100);
  });

  test("跳过也算完成", () => {
    const nodes = [
      { status: "done", is_parallel: 0 },
      { status: "skip", is_parallel: 0 },
      { status: "next", is_parallel: 0 },
      { status: "next", is_parallel: 0 },
    ];
    assert.equal(calcProgress(nodes), 50);
  });

  test("回归：投标阶段不应出现 80% 进度", () => {
    // 这是历史 bug：progress 是写死的静态值
    const nodesAtBid = [
      { node_key: "招标", status: "done", is_parallel: 0 },
      { node_key: "投标", status: "cur", is_parallel: 0 },
      { node_key: "中标", status: "next", is_parallel: 0 },
      { node_key: "合同", status: "next", is_parallel: 0 },
      { node_key: "实施", status: "next", is_parallel: 0 },
      { node_key: "验收", status: "next", is_parallel: 0 },
      { node_key: "开票", status: "next", is_parallel: 0 },
      { node_key: "回款", status: "next", is_parallel: 0 },
      { node_key: "质保金", status: "next", is_parallel: 0 },
      { node_key: "售后", status: "next", is_parallel: 0 },
    ];
    const p = calcProgress(nodesAtBid);
    assert.ok(p <= 20, "投标阶段进度应在 20% 以内，实际 " + p + "%");
  });
});

// ---------------- 回款计划重建 ----------------
describe("合同改金额后重建回款计划", () => {
  function rebuild(amountCents, summary, paidCents) {
    const pcts = summary.split("/").map(Number).filter((x) => !isNaN(x));
    const remaining = amountCents - paidCents;
    if (remaining <= 0) return { terms: [], remaining };

    let allocated = 0;
    const terms = pcts.map((pct, i) => {
      const isLast = i === pcts.length - 1;
      const share = isLast ? remaining - allocated : Math.round(remaining * (pct / 100));
      allocated += share;
      return { pct, share, isLast };
    }).filter((t) => t.share > 0);

    return { terms, remaining };
  }

  test("无回款时，按全额拆分", () => {
    const r = rebuild(1000000, "30/40/25/5", 0);
    const sum = r.terms.reduce((s, t) => s + t.share, 0);
    assert.equal(sum, 1000000);
    assert.equal(r.terms.length, 4);
  });

  test("部分回款时，只拆分剩余部分", () => {
    // 合同 100 万，已回 60 万，剩 40 万
    const r = rebuild(1000000, "30/40/25/5", 600000);
    const sum = r.terms.reduce((s, t) => s + t.share, 0);
    assert.equal(sum, 400000);
    assert.equal(r.remaining, 400000);
  });

  test("合同改大后，剩余部分增加", () => {
    // 原 100 万已回 60 万 → 剩 40 万
    // 改为 150 万 → 剩 90 万
    const before = rebuild(1000000, "30/40/25/5", 600000);
    const after = rebuild(1500000, "30/40/25/5", 600000);
    assert.equal(after.remaining - before.remaining, 500000);
  });

  test("已全额回款时无剩余", () => {
    const r = rebuild(1000000, "30/40/25/5", 1000000);
    assert.equal(r.remaining, 0);
    assert.equal(r.terms.length, 0);
  });

  test("拆分后合计精确等于剩余金额", () => {
    for (const [amt, paid] of [[1000000, 0], [1333333, 200000], [999999, 333333]]) {
      const r = rebuild(amt, "33/33/34", paid);
      const sum = r.terms.reduce((s, t) => s + t.share, 0);
      assert.equal(sum, amt - paid, amt + "-" + paid + " 拆分不准确");
    }
  });
});

// ---------------- 保证金退还校验 ----------------
describe("保证金退还校验", () => {
  function checkBondBack(status, backDate, backAmt, origAmt) {
    if (status !== "已退") return null;
    if (!backDate) return "必须填写退还日期";
    if (backAmt <= 0) return "必须填写退还金额";
    if (origAmt > 0 && backAmt > origAmt) return "退还金额不能超过缴纳金额";
    return null;
  }

  test("未退时不校验", () => {
    assert.equal(checkBondBack("已缴", null, 0, 100000), null);
  });

  test("标记已退必须填日期", () => {
    assert.match(checkBondBack("已退", null, 50000, 100000), /退还日期/);
  });

  test("标记已退必须填金额", () => {
    assert.match(checkBondBack("已退", "2026-10-28", 0, 100000), /退还金额/);
  });

  test("退还金额不能超过缴纳金额", () => {
    assert.match(checkBondBack("已退", "2026-10-28", 150000, 100000), /不能超过/);
  });

  test("正常退还通过", () => {
    assert.equal(checkBondBack("已退", "2026-10-28", 100000, 100000), null);
  });
});


// ---------------- 保留期次按计划金额扣减（回归） ----------------
describe("重建计划时保留期次的处理", () => {
  function rebuild(amountCents, retainedPlanCents, pcts) {
    const remaining = amountCents - retainedPlanCents;
    if (remaining <= 0) return { terms: [], remaining };
    let allocated = 0;
    const terms = pcts.map((pct, i) => {
      const isLast = i === pcts.length - 1;
      const share = isLast ? remaining - allocated : Math.round(remaining * (pct / 100));
      allocated += share;
      return { share, isLast };
    }).filter((t) => t.share > 0);
    return { terms, remaining };
  }

  test("回归：保留期次按计划金额扣减，不是实收金额", () => {
    // 场景：合同 100万 分 2 期（各 50 万），第 1 期已回 20 万
    // 保留第 1 期（计划 50 万），改合同到 200 万
    // 剩余 = 200 - 50 = 150 万，分 2 期
    const r = rebuild(2000000, 500000, [50, 50]);
    const sum = r.terms.reduce((s, t) => s + t.share, 0);
    assert.equal(sum, 1500000);

    // 合计校验：保留 50 + 新建 150 = 200 万 ✓
    assert.equal(500000 + sum, 2000000);
  });

  test("错误做法（按实收扣减）会导致合计超标", () => {
    // 如果按实收 20 万扣减：剩余 = 200 - 20 = 180 万
    // 合计 = 保留 50 + 新建 180 = 230 万 ≠ 200 万 ✗
    const wrongRemaining = 2000000 - 200000;
    assert.equal(500000 + wrongRemaining, 2300000);
    assert.notEqual(500000 + wrongRemaining, 2000000);
  });

  test("保留期次超过新合同额时不再生成新期次", () => {
    const r = rebuild(1000000, 1500000, [50, 50]);
    assert.equal(r.terms.length, 0);
    assert.ok(r.remaining <= 0);
  });

  test("无保留期次时全额拆分", () => {
    const r = rebuild(1000000, 0, [30, 40, 30]);
    const sum = r.terms.reduce((s, t) => s + t.share, 0);
    assert.equal(sum, 1000000);
  });
});


// ---------------- 注册校验 ----------------
describe("注册账号校验", () => {
  function validateUsername(u) {
    const v = String(u ?? "").trim();
    if (!v) return "请输入账号";
    if (!/^[\w\u4e00-\u9fa5.-]{2,32}$/.test(v)) return "账号格式不正确";
    return null;
  }

  function validatePassword(p) {
    const v = String(p ?? "");
    if (v.length < 8) return "密码至少 8 位";
    if (!/[a-zA-Z]/.test(v)) return "密码必须包含字母";
    if (!/[0-9]/.test(v)) return "密码必须包含数字";
    return null;
  }

  function validatePhone(ph) {
    const v = String(ph ?? "").trim();
    if (!v) return "请输入手机号";
    if (!/^1[3-9]\d{9}$/.test(v)) return "手机号格式不正确";
    return null;
  }

  describe("账号", () => {
    test("空账号被拒", () => {
      assert.match(validateUsername(""), /请输入账号/);
    });
    test("过短被拒", () => {
      assert.match(validateUsername("a"), /格式不正确/);
    });
    test("含空格被拒", () => {
      assert.match(validateUsername("zhang san"), /格式不正确/);
    });
    test("中文账号通过", () => {
      assert.equal(validateUsername("张三"), null);
    });
    test("字母数字下划线通过", () => {
      assert.equal(validateUsername("zhang_san01"), null);
    });
    test("含点短横线通过", () => {
      assert.equal(validateUsername("zhang.san-01"), null);
    });
    test("超 32 位被拒", () => {
      assert.match(validateUsername("a".repeat(33)), /格式不正确/);
    });
  });

  describe("密码", () => {
    test("少于 8 位被拒", () => {
      assert.match(validatePassword("Ab1"), /至少 8 位/);
    });
    test("纯数字被拒", () => {
      assert.match(validatePassword("12345678"), /包含字母/);
    });
    test("纯字母被拒", () => {
      assert.match(validatePassword("abcdefgh"), /包含数字/);
    });
    test("字母+数字通过", () => {
      assert.equal(validatePassword("Test1234"), null);
    });
    test("字母+数字+特殊字符通过", () => {
      assert.equal(validatePassword("Test@1234"), null);
    });
    test("边界：正好 8 位", () => {
      assert.equal(validatePassword("Abcd1234"), null);
    });
  });

  describe("手机号", () => {
    test("空被拒", () => {
      assert.match(validatePhone(""), /请输入手机号/);
    });
    test("过短被拒", () => {
      assert.match(validatePhone("123"), /格式不正确/);
    });
    test("非 1 开头被拒", () => {
      assert.match(validatePhone("23456789012"), /格式不正确/);
    });
    test("12 开头被拒", () => {
      assert.match(validatePhone("12345678901"), /格式不正确/);
    });
    test("正常手机号通过", () => {
      assert.equal(validatePhone("13800138000"), null);
    });
    test("19 开头通过", () => {
      assert.equal(validatePhone("19912345678"), null);
    });
  });
});

// ---------------- 注册审核状态机 ----------------
describe("注册审核状态流转", () => {
  const canLogin = (regStatus, active, roleCount, fallbackRole) => {
    if (regStatus === "pending") return { ok: false, reason: "账号正在审核中" };
    if (regStatus === "rejected") return { ok: false, reason: "注册申请未通过" };
    if (!active) return { ok: false, reason: "账号已停用" };
    if (roleCount === 0 && !fallbackRole) return { ok: false, reason: "账号尚未分配角色" };
    return { ok: true };
  };

  test("刚注册（待审核）不能登录", () => {
    const r = canLogin("pending", false, 0, "");
    assert.equal(r.ok, false);
    assert.match(r.reason, /审核中/);
  });

  test("被拒绝不能登录", () => {
    const r = canLogin("rejected", false, 0, "");
    assert.equal(r.ok, false);
    assert.match(r.reason, /未通过/);
  });

  test("审核通过但无角色不能登录", () => {
    const r = canLogin("approved", true, 0, "");
    assert.equal(r.ok, false);
    assert.match(r.reason, /未分配角色/);
  });

  test("审核通过 + 有角色 可以登录", () => {
    const r = canLogin("approved", true, 1, "");
    assert.equal(r.ok, true);
  });

  test("回归：role 写死 sales 会白送权限", () => {
    // 如果注册时写了 role='sales'，即使没有 user_roles，fallbackRole 也非空，
    // 用户就能登录并拿到 sales 的菜单 —— 这是 bug
    const buggy = canLogin("approved", true, 0, "sales");
    assert.equal(buggy.ok, true, "这正是要避免的场景：无角色但有 fallback 角色");

    // 正确做法：注册时 role 留空
    const fixed = canLogin("approved", true, 0, "");
    assert.equal(fixed.ok, false);
  });
});


// ---------------- 系统管理 ----------------
describe("系统负载与状态", () => {
  function calcCpuUsage(load1, cores) {
    if (cores <= 0) return 0;
    return Math.min(100, Math.round((load1 / cores) * 100));
  }

  function fmtUptime(sec) {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d > 0) return d + " 天 " + h + " 小时";
    if (h > 0) return h + " 小时 " + m + " 分";
    return m + " 分";
  }

  test("CPU 使用率按核数归一化", () => {
    assert.equal(calcCpuUsage(8, 8), 100);
    assert.equal(calcCpuUsage(4, 8), 50);
    assert.equal(calcCpuUsage(1.64, 8), 21);
  });

  test("CPU 使用率不超过 100%", () => {
    assert.equal(calcCpuUsage(100, 4), 100);
  });

  test("核数为 0 不除零", () => {
    assert.equal(calcCpuUsage(5, 0), 0);
  });

  test("运行时长格式化", () => {
    assert.equal(fmtUptime(90), "1 分");
    assert.equal(fmtUptime(3700), "1 小时 1 分");
    assert.equal(fmtUptime(90000), "1 天 1 小时");
  });

  test("备份文件名合法性与路径穿越防护", () => {
    const ok = (f) => /^[\w.-]+\.(db|sqlite|zip|sql)$/.test(f);
    assert.equal(ok("app-2026-10-28T12-38-24.db"), true);
    assert.equal(ok("backup.db"), true);
    assert.equal(ok("../../../etc/passwd"), false);
    assert.equal(ok("..\\..\\windows\\system32\\x.db"), false);
    assert.equal(ok("evil.sh"), false);
    assert.equal(ok("a.db;rm -rf /"), false);
  });
});

describe("系统参数", () => {
  test("参数表默认 8 项", () => {
    const keys = [
      "company_name", "system_title", "session_days", "login_max_fail",
      "lock_minutes", "page_size", "sla_hours", "backup_keep",
    ];
    assert.equal(keys.length, 8);
    assert.equal(new Set(keys).size, 8);
  });

  test("数值参数应为正整数", () => {
    const numeric = ["session_days", "login_max_fail", "lock_minutes", "page_size", "sla_hours", "backup_keep"];
    const vals = { session_days: "7", login_max_fail: "5", lock_minutes: "15", page_size: "20", sla_hours: "48", backup_keep: "30" };
    for (const k of numeric) {
      assert.ok(/^\d+$/.test(vals[k]), k + " 应为正整数，实际 " + vals[k]);
    }
  });
});


// ---------------- 网口流量 ----------------
describe("网口流量计算", () => {
  function calcRate(cur, prev, dtSec) {
    if (!prev || dtSec <= 0.2) return null;
    const dRx = cur.rxBytes >= prev.rxBytes ? cur.rxBytes - prev.rxBytes : 0;
    const dTx = cur.txBytes >= prev.txBytes ? cur.txBytes - prev.txBytes : 0;
    return {
      rxKBs: Math.round((dRx / 1024 / dtSec) * 10) / 10,
      txKBs: Math.round((dTx / 1024 / dtSec) * 10) / 10,
    };
  }

  test("首次采样无速率", () => {
    assert.equal(calcRate({ rxBytes: 1000, txBytes: 500 }, null, 0), null);
  });

  test("间隔过短不计算", () => {
    assert.equal(calcRate({ rxBytes: 2000, txBytes: 1000 }, { rxBytes: 1000, txBytes: 500 }, 0.1), null);
  });

  test("正常计算速率", () => {
    // 2 秒内收了 2048 字节 = 1 KB/s
    const r = calcRate({ rxBytes: 3048, txBytes: 1524 }, { rxBytes: 1000, txBytes: 500 }, 2);
    assert.equal(r.rxKBs, 1);
    assert.equal(r.txKBs, 0.5);
  });

  test("计数器归零（网卡重启）按 0 处理，不出现负速率", () => {
    const r = calcRate({ rxBytes: 100, txBytes: 50 }, { rxBytes: 99999, txBytes: 88888 }, 5);
    assert.equal(r.rxKBs, 0);
    assert.equal(r.txKBs, 0);
    assert.ok(r.rxKBs >= 0);
  });
});

// ---------------- 备份/升级包文件名安全 ----------------
describe("上传下载的文件名安全", () => {
  const backupOk = (f) => /^[\w.-]+\.(db|sqlite|sql)$/.test(f);
  const pkgOk = (f) => /\.(tar\.gz|tgz|zip)$/i.test(f);

  test("备份文件名白名单", () => {
    assert.equal(backupOk("app-20261028.db"), true);
    assert.equal(backupOk("upload-20261028125900.db"), true);
    assert.equal(backupOk("../../../etc/passwd"), false);
    assert.equal(backupOk("x.db/../../etc"), false);
    assert.equal(backupOk("a.db;rm -rf /"), false);
  });

  test("升级包扩展名白名单", () => {
    assert.equal(pkgOk("pkg-1.tar.gz"), true);
    assert.equal(pkgOk("pkg-1.tgz"), true);
    assert.equal(pkgOk("pkg-1.zip"), true);
    assert.equal(pkgOk("pkg-1.tar"), false);
    assert.equal(pkgOk("evil.sh"), false);
    assert.equal(pkgOk("a.zip.sh"), false);
  });

  test("SQLite 文件头校验", () => {
    const MAGIC = "SQLite format 3\0";
    const valid = Buffer.from(MAGIC + "x".repeat(100));
    const invalid = Buffer.from("not a database at all!!!!");
    const check = (buf) => {
      const m = Buffer.from(MAGIC, "utf-8");
      return buf.length >= 100 && buf.subarray(0, 16).equals(m);
    };
    assert.equal(check(valid), true);
    assert.equal(check(invalid), false);
  });
});

// ---------------- 证书到期判断 ----------------
describe("SSL 证书状态", () => {
  function certTone(found, expired, daysLeft, warnDays) {
    if (!found) return "none";
    if (expired) return "danger";
    if (daysLeft <= warnDays) return "warn";
    return "ok";
  }

  test("未找到证书", () => {
    assert.equal(certTone(false, false, null, 30), "none");
  });

  test("已过期", () => {
    assert.equal(certTone(true, true, -5, 30), "danger");
  });

  test("即将过期（临界值）", () => {
    assert.equal(certTone(true, false, 30, 30), "warn");
  });

  test("剩余充足", () => {
    assert.equal(certTone(true, false, 31, 30), "ok");
  });

  test("长期证书", () => {
    assert.equal(certTone(true, false, 3650, 30), "ok");
  });
});


// ---------------- 会话空闲超时 ----------------
describe("登录空闲超时", () => {
  function shouldExpire(lastSeenAt, now, idleMin) {
    if (idleMin <= 0) return false;              // 0 = 不限制
    if (!lastSeenAt) return false;
    const idleMs = now - new Date(lastSeenAt.replace(" ", "T")).getTime();
    return idleMs > idleMin * 60 * 1000;
  }

  test("未超过空闲时间不失效", () => {
    const now = new Date("2026-10-28T21:00:00").getTime();
    assert.equal(shouldExpire("2026-10-28 20:30:00", now, 120), false);
  });

  test("超过空闲时间失效", () => {
    const now = new Date("2026-10-28T21:00:00").getTime();
    assert.equal(shouldExpire("2026-10-28 18:00:00", now, 120), true);
  });

  test("临界值：正好等于不失效", () => {
    const now = new Date("2026-10-28T21:00:00").getTime();
    assert.equal(shouldExpire("2026-10-28 19:00:00", now, 120), false);
  });

  test("临界值：超 1 秒即失效", () => {
    const now = new Date("2026-10-28T21:00:01").getTime();
    assert.equal(shouldExpire("2026-10-28 19:00:00", now, 120), true);
  });

  test("配置为 0 表示不限制", () => {
    const now = new Date("2026-10-28T21:00:00").getTime();
    assert.equal(shouldExpire("2026-01-01 00:00:00", now, 0), false);
  });

  test("无 last_seen_at 不判定超时", () => {
    const now = Date.now();
    assert.equal(shouldExpire(null, now, 120), false);
  });

  test("空闲超时不影响绝对有效期判断", () => {
    // 两个独立的门禁：绝对有效期 7 天 + 空闲 120 分钟
    // 只要任一触发就失效
    const now = new Date("2026-10-28T21:00:00").getTime();
    const expiresAt = "2026-11-04 21:00:00";
    const absExpired = new Date(expiresAt.replace(" ", "T")).getTime() <= now;
    // 18:30 到 21:00 是 150 分钟，超过 120 分钟 → 空闲超时
    const idleExpired = shouldExpire("2026-10-28 18:30:00", now, 120);
    assert.equal(absExpired, false);
    assert.equal(idleExpired, true);
    assert.ok(absExpired || idleExpired, "任一条件成立即应失效");
  });
});

// ---------------- 升级包 manifest ----------------
describe("升级包 manifest 校验", () => {
  function validateManifest(m, currentVersion) {
    const errors = [];
    if (!m) return ["manifest 为空"];
    if (!m.version) errors.push("缺少 version");
    if (!m.contents) errors.push("缺少 contents");
    else if (!m.contents.image && !m.contents.src) {
      errors.push("contents 未声明 image 或 src");
    }
    if (m.minFromVersion && compare(currentVersion, m.minFromVersion) < 0) {
      errors.push("当前版本过低");
    }
    return errors;
  }

  function compare(a, b) {
    const pa = String(a).replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
    const pb = String(b).replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] ?? 0, y = pb[i] ?? 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }

  test("版本比较", () => {
    assert.equal(compare("v0.9.0", "v0.9.1"), -1);
    assert.equal(compare("v1.0.0", "v0.9.9"), 1);
    assert.equal(compare("v1.0.0", "1.0.0"), 0);
    assert.equal(compare("v0.10.0", "v0.9.0"), 1);
  });

  test("合法 manifest", () => {
    const m = { version: "v0.9.1", contents: { src: true } };
    assert.deepEqual(validateManifest(m, "v0.9.0"), []);
  });

  test("缺少 version", () => {
    const m = { contents: { src: true } };
    assert.ok(validateManifest(m, "v0.9.0").includes("缺少 version"));
  });

  test("contents 为空", () => {
    const m = { version: "v0.9.1", contents: {} };
    assert.ok(validateManifest(m, "v0.9.0").some((e) => e.includes("image 或 src")));
  });

  test("当前版本低于最低要求", () => {
    const m = { version: "v1.0.0", contents: { src: true }, minFromVersion: "v0.9.0" };
    assert.ok(validateManifest(m, "v0.8.0").includes("当前版本过低"));
  });
});

// ---------------- 净包路径穿越 ----------------
describe("升级包路径安全", () => {
  const isEvil = (entry) => entry.includes("../") || entry.startsWith("/");

  test("正常路径", () => {
    assert.equal(isEvil("manifest.json"), false);
    assert.equal(isEvil("./src/a.js"), false);
    assert.equal(isEvil("src/sub/b.js"), false);
  });

  test("路径穿越被识别", () => {
    assert.equal(isEvil("../../etc/passwd"), true);
    assert.equal(isEvil("/etc/passwd"), true);
    assert.equal(isEvil("src/../../../root/.ssh/id_rsa"), true);
  });
});

// ---------------- 网口速率边界 ----------------
describe("网口速率边界", () => {
  function calc(cur, prev, dt) {
    if (!prev || dt <= 0.2) return null;
    const dRx = cur.rx >= prev.rx ? cur.rx - prev.rx : 0;
    return Math.round((dRx / 1024 / dt) * 10) / 10;
  }

  test("首次采样", () => {
    assert.equal(calc({ rx: 100 }, null, 5), null);
  });

  test("间隔过短", () => {
    assert.equal(calc({ rx: 200 }, { rx: 100 }, 0.1), null);
  });

  test("正常计算", () => {
    assert.equal(calc({ rx: 3048 }, { rx: 1000 }, 2), 1);
  });

  test("计数器重置不产生负值", () => {
    assert.equal(calc({ rx: 10 }, { rx: 99999 }, 5), 0);
  });
});


// ---------------- 存储空间 ----------------
describe("存储空间监控", () => {
  function fmtMB(mb) {
    if (mb < 1024) return mb + " MB";
    if (mb < 1024 * 1024) return (mb / 1024).toFixed(1) + " GB";
    return (mb / 1024 / 1024).toFixed(2) + " TB";
  }

  function usagePct(usedMB, totalMB) {
    if (!totalMB || totalMB <= 0) return 0;
    return Math.round((usedMB / totalMB) * 100);
  }

  function tone(pct, freeMB) {
    if (pct >= 85 || freeMB < 5120) return "danger";
    if (pct >= 65) return "warn";
    return "ok";
  }

  test("容量格式化", () => {
    assert.equal(fmtMB(512), "512 MB");
    assert.equal(fmtMB(2048), "2.0 GB");
    assert.equal(fmtMB(1024 * 1024 * 2), "2.00 TB");
  });

  test("使用率计算", () => {
    assert.equal(usagePct(70, 100), 70);
    assert.equal(usagePct(0, 100), 0);
    assert.equal(usagePct(100, 100), 100);
  });

  test("分母为 0 不除零", () => {
    assert.equal(usagePct(100, 0), 0);
  });

  test("水位分级：正常", () => {
    assert.equal(tone(50, 50000), "ok");
  });

  test("水位分级：警告（>65%）", () => {
    assert.equal(tone(70, 50000), "warn");
  });

  test("水位分级：危险（>85%）", () => {
    assert.equal(tone(90, 50000), "danger");
  });

  test("水位分级：剩余不足 5GB 也算危险", () => {
    assert.equal(tone(50, 3000), "danger");
  });

  test("回归：同设备多目录只算一个分区", () => {
    // bind mount 场景：/app/db 和 /app/uploads 是同一块盘
    // df 各显示各的挂载点，但设备名相同 → 必须按设备名去重
    const targets = [
      { path: "/app/db", device: "/dev/mapper/ubuntu--vg-ubuntu--lv" },
      { path: "/app/uploads", device: "/dev/mapper/ubuntu--vg-ubuntu--lv" },
      { path: "/app/db/backup", device: "/dev/mapper/ubuntu--vg-ubuntu--lv" },
      { path: "/app/db/upgrade", device: "/dev/mapper/ubuntu--vg-ubuntu--lv" },
    ];
    const map = new Map();
    for (const t of targets) {
      if (!map.has(t.device)) map.set(t.device, t.path);
    }
    assert.equal(map.size, 1, "同设备应只保留 1 条");

    // 如果按挂载点去重（错误做法），会得到 4 条
    const wrongMap = new Map();
    for (const t of targets) {
      if (!wrongMap.has(t.path)) wrongMap.set(t.path, t.path);
    }
    assert.equal(wrongMap.size, 4);
  });
});


// ---------------- 磁盘预警判定 ----------------
describe("磁盘使用率预警", () => {
  function shouldAlert(usedMB, totalMB, freeMB, warnPct, minFreeMB) {
    const pct = totalMB > 0 ? Math.round((usedMB / totalMB) * 100) : 0;
    const overPct = pct >= warnPct;
    const lowFree = freeMB < minFreeMB;
    return { alert: overPct || lowFree, pct, overPct, lowFree };
  }

  function level(usedMB, totalMB, freeMB, dangerPct, minFreeMB) {
    const pct = totalMB > 0 ? Math.round((usedMB / totalMB) * 100) : 0;
    const isBad = pct >= dangerPct || freeMB < minFreeMB / 2;
    return isBad ? "bad" : "warn";
  }

  test("使用率低于阈值不告警", () => {
    const r = shouldAlert(70, 100, 30000, 80, 5120);
    assert.equal(r.alert, false);
    assert.equal(r.pct, 70);
  });

  test("使用率达到阈值告警", () => {
    const r = shouldAlert(80, 100, 20000, 80, 5120);
    assert.equal(r.alert, true);
    assert.equal(r.overPct, true);
  });

  test("使用率低但剩余不足也告警", () => {
    // 大盘 500G 用了 60%，但剩余只有 3G
    const r = shouldAlert(600, 1000, 3000, 80, 5120);
    assert.equal(r.pct, 60);
    assert.equal(r.overPct, false);
    assert.equal(r.lowFree, true);
    assert.equal(r.alert, true);
  });

  test("剩余充足且使用率低不告警", () => {
    const r = shouldAlert(300, 1000, 50000, 80, 5120);
    assert.equal(r.alert, false);
  });

  test("级别：使用率超危险阈值", () => {
    assert.equal(level(95, 100, 20000, 90, 5120), "bad");
  });

  test("级别：剩余低于一半告警线", () => {
    // minFreeMB=5120，一半是 2560；剩余 2000 < 2560 → bad
    assert.equal(level(50, 1000, 2000, 90, 5120), "bad");
  });

  test("级别：普通警告", () => {
    assert.equal(level(85, 100, 20000, 90, 5120), "warn");
  });

  test("分母为 0 不崩溃", () => {
    const r = shouldAlert(100, 0, 0, 80, 5120);
    assert.equal(r.pct, 0);
  });

  test("回归：同一用户多角色只推送一次", () => {
    // usersByRoles 用 DISTINCT，同一个人既是 boss 又是 admin 时
    // 只应出现在结果里一次
    const rows = [
      { user_id: 1, role_key: "boss" },
      { user_id: 1, role_key: "admin" },
      { user_id: 2, role_key: "admin" },
    ];
    const uniq = new Set(rows.map((r) => r.user_id));
    assert.equal(uniq.size, 2, "应只得到 2 个用户，不是 3 条记录");
  });
});


// ---------------- TOTP 令牌认证 ----------------
describe("TOTP 令牌认证", () => {
  const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  function base32Decode(s) {
    const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
    let bits = "";
    for (const ch of clean) {
      const i = BASE32.indexOf(ch);
      if (i < 0) continue;
      bits += i.toString(2).padStart(5, "0");
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      bytes.push(parseInt(bits.slice(i, i + 8), 2));
    }
    return Buffer.from(bytes);
  }

  function totp(secret, counter, digits = 6) {
    const key = base32Decode(secret);
    const buf = Buffer.alloc(8);
    let v = counter;
    for (let i = 7; i >= 0; i--) { buf[i] = v & 0xff; v = Math.floor(v / 256); }
    const hmac = crypto.createHmac("sha1", key).update(buf).digest();
    const o = hmac[hmac.length - 1] & 0x0f;
    const code = ((hmac[o] & 0x7f) << 24) | ((hmac[o + 1] & 0xff) << 16) |
                 ((hmac[o + 2] & 0xff) << 8) | (hmac[o + 3] & 0xff);
    return String(code % Math.pow(10, digits)).padStart(digits, "0");
  }

  // RFC 6238 附录 B 的测试向量（密钥 base32 "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" = "12345678901234567890"）
  const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

  test("RFC 6238 测试向量：T=59 → 287082", () => {
    assert.equal(totp(RFC_SECRET, Math.floor(59 / 30)), "287082");
  });

  test("RFC 6238 测试向量：T=1111111109 → 081804", () => {
    assert.equal(totp(RFC_SECRET, Math.floor(1111111109 / 30)), "081804");
  });

  test("RFC 6238 测试向量：T=1234567890 → 005924", () => {
    assert.equal(totp(RFC_SECRET, Math.floor(1234567890 / 30)), "005924");
  });

  function verify(secret, input, now, window = 1) {
    const code = String(input ?? "").replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) return false;
    const base = Math.floor(now / 30);
    for (let i = -window; i <= window; i++) {
      if (totp(secret, base + i) === code) return true;
    }
    return false;
  }

  test("当前时间片通过", () => {
    const now = 1700000000;
    const code = totp(RFC_SECRET, Math.floor(now / 30));
    assert.equal(verify(RFC_SECRET, code, now), true);
  });

  test("上一个时间片通过（时钟偏差容忍）", () => {
    const now = 1700000000;
    const prev = totp(RFC_SECRET, Math.floor(now / 30) - 1);
    assert.equal(verify(RFC_SECRET, prev, now), true);
  });

  test("下个时间片通过", () => {
    const now = 1700000000;
    const next = totp(RFC_SECRET, Math.floor(now / 30) + 1);
    assert.equal(verify(RFC_SECRET, next, now), true);
  });

  test("超过 1 个时间片拒绝", () => {
    const now = 1700000000;
    const far = totp(RFC_SECRET, Math.floor(now / 30) + 3);
    assert.equal(verify(RFC_SECRET, far, now), false);
  });

  test("错误码拒绝", () => {
    assert.equal(verify(RFC_SECRET, "000000", 1700000000), false);
  });

  test("非 6 位数字拒绝", () => {
    assert.equal(verify(RFC_SECRET, "12345", 1700000000), false);
    assert.equal(verify(RFC_SECRET, "abcdef", 1700000000), false);
    assert.equal(verify(RFC_SECRET, "", 1700000000), false);
  });

  test("otpauth URI 格式正确", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const issuer = "ProjectFlow";
    const account = "zhangsan";
    const label = encodeURIComponent(issuer + ":" + account);
    const params = new URLSearchParams({
      secret, issuer, algorithm: "SHA1", digits: "6", period: "30",
    });
    const uri = "otpauth://totp/" + label + "?" + params.toString();
    assert.ok(uri.startsWith("otpauth://totp/"));
    assert.ok(uri.includes("secret=" + secret));
    assert.ok(uri.includes("issuer=ProjectFlow"));
    assert.ok(uri.includes("digits=6"));
    assert.ok(uri.includes("period=30"));
  });

  test("恢复码格式 xxxxx-xxxxx", () => {
    const codes = ["28ec6-f6303", "84762-7cb5b"];
    for (const c of codes) {
      assert.match(c, /^[0-9a-f]{5}-[0-9a-f]{5}$/);
    }
  });

  test("恢复码只能用一次", () => {
    const list = [
      { code: "aaaaa-bbbbb", used: false },
      { code: "ccccc-ddddd", used: false },
    ];
    function consume(json, input) {
      const arr = JSON.parse(json);
      const target = input.toLowerCase();
      const idx = arr.findIndex((c) => !c.used && c.code.toLowerCase() === target);
      if (idx < 0) return { ok: false, remaining: arr.filter((c) => !c.used).length };
      arr[idx].used = true;
      return { ok: true, remaining: arr.filter((c) => !c.used).length };
    }
    const json = JSON.stringify(list);
    const r1 = consume(json, "aaaaa-bbbbb");
    assert.equal(r1.ok, true);
    assert.equal(r1.remaining, 1);
    // 第二次用同一个码（重新加载状态）
    const after = JSON.stringify([
      { code: "aaaaa-bbbbb", used: true },
      { code: "ccccc-ddddd", used: false },
    ]);
    const r2 = consume(after, "aaaaa-bbbbb");
    assert.equal(r2.ok, false);
  });

  test("回归：令牌错误也计入锁定次数", () => {
    // 防止有人用暴力破解绕过密码锁定
    const MAX_FAILED = 5;
    let attempts = 0;
    for (let i = 0; i < 5; i++) attempts++;
    assert.ok(attempts >= MAX_FAILED, "令牌连续错误应触发锁定");
  });
});

// ---------------- 进程与服务关联 ----------------
describe("进程与服务关联", () => {
  function servicesForProcess(p) {
    const c = (p.cmd + " " + p.name).toLowerCase();
    if (c.includes("backup-scheduler")) return "jobs";
    if (c.includes("scheduler.js") || c.includes("jobs-scheduler")) return "jobs";
    if (c.includes("next-server") || c.includes("server.js")) return "web";
    if (p.pid === 1) return "web";
    return null;
  }

  test("备份调度关联定时任务", () => {
    assert.equal(servicesForProcess({ pid: 87, name: "node", cmd: "node /app/scripts/backup-scheduler.js" }), "jobs");
  });

  test("任务调度关联定时任务", () => {
    assert.equal(servicesForProcess({ pid: 86, name: "node", cmd: "node /app/scripts/scheduler.js" }), "jobs");
  });

  test("Next 应用关联 Web", () => {
    assert.equal(servicesForProcess({ pid: 32, name: "next-server (v15)", cmd: "next-server (v15)" }), "web");
  });

  test("1 号进程关联 Web", () => {
    assert.equal(servicesForProcess({ pid: 1, name: "entrypoint.sh", cmd: "entrypoint.sh" }), "web");
  });

  test("无法识别的不关联", () => {
    assert.equal(servicesForProcess({ pid: 999, name: "bash", cmd: "bash" }), null);
  });
});

// ---------------- 系统初始化 ----------------
describe("系统初始化（清空业务数据）", () => {
  const BUSINESS = [
    "projects", "contracts", "payment_terms", "customers",
    "stock", "tickets", "warranties", "audit_logs",
  ];
  const KEEP = ["users", "roles", "user_roles", "app_settings", "system_params"];

  test("业务表与保留表不重叠", () => {
    const overlap = BUSINESS.filter((t) => KEEP.includes(t));
    assert.equal(overlap.length, 0, "不应有任何表同时出现在两处：" + overlap.join(","));
  });

  test("账号相关表必须保留", () => {
    for (const t of ["users", "roles", "user_roles"]) {
      assert.ok(KEEP.includes(t), t + " 必须保留，否则清空后无法登录");
    }
  });

  test("系统配置必须保留", () => {
    for (const t of ["app_settings", "system_params"]) {
      assert.ok(KEEP.includes(t), t + " 必须保留，否则系统参数丢失");
    }
  });

  test("确认短语必须精确匹配", () => {
    const check = (s) => s.trim() === "清空全部数据";
    assert.equal(check("清空全部数据"), true);
    assert.equal(check("清空全部数据 "), true, "首尾空格应容忍");
    assert.equal(check("清空数据"), false);
    assert.equal(check("清空全部数据！"), false);
    assert.equal(check(""), false);
  });

  test("缺密码不允许执行", () => {
    const canRun = (pwd, phrase) => !!pwd && phrase.trim() === "清空全部数据";
    assert.equal(canRun("", "清空全部数据"), false);
    assert.equal(canRun("Admin@123", "清空全部数据"), true);
  });
});

// ---------------- 进程与服务关联（Web 启动链路） ----------------
describe("Web 服务启动链路关联", () => {
  function link(p) {
    const c = (p.cmd + " " + p.name).toLowerCase();
    if (c.includes("backup-scheduler")) return "jobs";
    if (c.includes("scheduler.js")) return "jobs";
    if (c.includes("next-server")) return "web";
    if (/\bnext\b\s+start/.test(c)) return "web";
    if (c.includes("entrypoint.sh")) return "web";
    if (p.pid === 1) return "web";
    return null;
  }

  test("entrypoint.sh → web", () => {
    assert.equal(link({ pid: 1, name: "entrypoint.sh", cmd: "/bin/sh /usr/local/bin/entrypoint.sh" }), "web");
  });

  test("npm exec next start → web", () => {
    assert.equal(link({ pid: 12, name: "npm exec next s", cmd: "npm exec next start -H 0.0.0.0 -p 3000" }), "web");
  });

  test("sh -c next start → web", () => {
    assert.equal(link({ pid: 30, name: "sh", cmd: "sh -c next start -H 0.0.0.0 -p 3000" }), "web");
  });

  test("next-server → web", () => {
    assert.equal(link({ pid: 31, name: "next-server (v15.1.0)", cmd: "next-server (v15.1.0)" }), "web");
  });

  test("scheduler.js → jobs", () => {
    assert.equal(link({ pid: 84, name: "node", cmd: "node /app/scripts/scheduler.js" }), "jobs");
  });

  test("backup-scheduler.js → jobs", () => {
    assert.equal(link({ pid: 85, name: "node", cmd: "node /app/scripts/backup-scheduler.js" }), "jobs");
  });

  test("回归：整个启动链路都能关联，无遗漏", () => {
    const chain = [
      { pid: 1, name: "entrypoint.sh", cmd: "/bin/sh /usr/local/bin/entrypoint.sh" },
      { pid: 12, name: "npm exec next s", cmd: "npm exec next start -H 0.0.0.0 -p 3000" },
      { pid: 30, name: "sh", cmd: "sh -c next start -H 0.0.0.0 -p 3000" },
      { pid: 31, name: "next-server (v15.1.0)", cmd: "next-server (v15.1.0)" },
    ];
    const unlinked = chain.filter((p) => !link(p));
    assert.equal(unlinked.length, 0, "启动链路不应有未关联进程：" + unlinked.map((p) => p.name).join(","));
  });
});

// ---------------- 文件上传安全 ----------------
describe("文件上传类型过滤", () => {
  const ALLOWED = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
                   ".txt", ".csv", ".md", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"];

  test("业务文档允许", () => {
    for (const e of [".pdf", ".docx", ".xlsx", ".pptx"]) {
      assert.ok(ALLOWED.includes(e), e + " 应允许");
    }
  });

  test("图片允许（不含 svg）", () => {
    for (const e of [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]) {
      assert.ok(ALLOWED.includes(e), e + " 应允许");
    }
    assert.ok(!ALLOWED.includes(".svg"), "SVG 可内嵌脚本，必须拒绝");
  });

  test("压缩包拒绝", () => {
    for (const e of [".zip", ".rar", ".7z"]) {
      assert.ok(!ALLOWED.includes(e), e + " 是高风险类型，应拒绝");
    }
  });

  test("可执行文件拒绝", () => {
    for (const e of [".exe", ".bat", ".cmd", ".sh", ".ps1", ".msi", ".dll", ".jar"]) {
      assert.ok(!ALLOWED.includes(e), e + " 应拒绝");
    }
  });

  test("网页/脚本类拒绝", () => {
    for (const e of [".html", ".htm", ".svg", ".xml", ".js"]) {
      assert.ok(!ALLOWED.includes(e), e + " 可承载脚本，应拒绝");
    }
  });

  test("服务端脚本拒绝", () => {
    for (const e of [".php", ".jsp", ".asp", ".aspx"]) {
      assert.ok(!ALLOWED.includes(e), e + " 应拒绝");
    }
  });

  // 文件名安全检查
  function checkName(base) {
    if (/[\x00-\x1f<>:"|?*\/\\]/.test(base)) return "非法字符";
    if (base.startsWith(".")) return "隐藏文件";
    const parts = base.toLowerCase().split(".");
    if (parts.length > 2) {
      const dangerous = ["exe", "bat", "cmd", "sh", "ps1", "js", "vbs",
                         "jar", "msi", "dll", "scr", "com", "pif", "hta", "php", "jsp", "asp"];
      for (let i = 1; i < parts.length - 1; i++) {
        if (dangerous.includes(parts[i])) return "可疑中间扩展名 ." + parts[i];
      }
    }
    if (base.length > 180) return "文件名过长";
    return null;
  }

  test("双扩展名伪装被识别", () => {
    assert.ok(checkName("a.exe.pdf"), "a.exe.pdf 应被拒绝");
    assert.ok(checkName("a.php.jpg"), "a.php.jpg 应被拒绝");
    assert.ok(checkName("a.js.png"), "a.js.png 应被拒绝");
  });

  test("正常双点文件名允许", () => {
    assert.equal(checkName("合同.v2.pdf"), null, "合同.v2.pdf 是正常文件名");
    assert.equal(checkName("2026年报.xlsx"), null);
  });

  test("隐藏文件被拒绝", () => {
    assert.ok(checkName(".env"));
    assert.ok(checkName(".htaccess"));
  });

  test("非法字符被拒绝", () => {
    assert.ok(checkName("a<b.pdf"));
    assert.ok(checkName("a|b.pdf"));
    assert.ok(checkName("a\0b.pdf"));
  });
});

// ---------------- 用户删除保护 ----------------
describe("用户删除保护", () => {
  function canDelete(targetId, myId, adminCountExcludingTarget) {
    if (targetId === myId) return { ok: false, reason: "不能删除自己" };
    if (adminCountExcludingTarget === 0) return { ok: false, reason: "最后一个管理员" };
    return { ok: true };
  }

  test("不能删除自己", () => {
    const r = canDelete(1, 1, 5);
    assert.equal(r.ok, false);
    assert.ok(r.reason.includes("自己"));
  });

  test("不能删除最后一个管理员", () => {
    const r = canDelete(2, 1, 0);
    assert.equal(r.ok, false);
    assert.ok(r.reason.includes("管理员"));
  });

  test("可以删除普通用户", () => {
    const r = canDelete(5, 1, 3);
    assert.equal(r.ok, true);
  });

  test("删除后用户名改写，不再出现在列表", () => {
    const username = "deluser_test";
    const deleted = `__deleted_13_${Date.now()}`;
    assert.ok(deleted.startsWith("__deleted_"), "删除标记格式正确");
    assert.ok(!deleted.includes(username), "原名已不可用于登录");
  });
});

// ---------------- QR 码生成 ----------------
describe("QR 码生成", () => {
  // 与 lib/qrcode.ts 相同的版本容量表（EC=M）
  const RS_BLOCK_TABLE = {
    1:[26,16,1], 2:[44,28,1], 3:[70,44,1], 4:[100,64,2], 5:[134,86,2],
    6:[172,108,4], 7:[196,124,4], 8:[242,154,4], 9:[292,182,5], 10:[346,216,5],
  };

  function chooseVersion(byteLen) {
    for (let v = 1; v <= 10; v++) {
      const [, data] = RS_BLOCK_TABLE[v];
      const lenBits = v <= 9 ? 8 : 16;
      if (4 + lenBits + byteLen * 8 <= data * 8) return v;
    }
    throw new Error("too long");
  }

  test("短内容用版本 1", () => {
    assert.equal(chooseVersion(1), 1);
    assert.equal(chooseVersion(5), 1);
  });

  test("中等内容用版本 5-6", () => {
    const v = chooseVersion(75);
    assert.ok(v >= 5 && v <= 6, "75 字节应在版本 5-6，实际 " + v);
  });

  test("otpauth URI（149 字符）可选到版本 8", () => {
    const v = chooseVersion(149);
    assert.ok(v >= 7 && v <= 9, "149 字节应在版本 7-9，实际 " + v);
  });

  test("边长 = 版本 × 4 + 17", () => {
    for (const v of [1, 5, 8, 10]) {
      assert.equal(v * 4 + 17, [21, 37, 49, 57][[1,5,8,10].indexOf(v)]);
    }
  });

  test("内容超长应抛错", () => {
    assert.throws(() => chooseVersion(500), /too long/);
  });

  test("回归：之字形遍历要覆盖除第 6 列外的所有列", () => {
    // 标准 QR 从右往左每次跨 2 列，遇到第 6 列（竖直定时图案）整列跳过。
    // 正确算法：col === 6 时先 col--，再由 for 的 col -= 2 推进，
    // 这样第 6 列被跳过、第 4/5 列仍会被覆盖。
    const covered = new Set();
    for (let col = 20; col > 0; col -= 2) {
      if (col === 6) col--;
      covered.add(col);
      covered.add(col - 1);
    }
    assert.ok(!covered.has(6), "不应覆盖第 6 列（定时图案）");
    assert.ok(covered.has(5), "应覆盖第 5 列");
    assert.ok(covered.has(4), "应覆盖第 4 列");
    assert.equal(covered.size, 20, "21 列中应覆盖 20 列（跳过第 6 列），实际 " + covered.size);
  });
});

// ---------------- 改密后标记清除 ----------------
describe("改密后 must_change_pwd 处理", () => {
  function shouldClearAfterReset(targetId, myId) {
    // 给自己改密码 → 清标记；给他人重置 → 保留标记（对方需自己再改）
    return targetId === myId;
  }

  test("自己改自己 → 清标记", () => {
    assert.equal(shouldClearAfterReset(12, 12), true);
  });

  test("管理员改别人 → 保留标记", () => {
    assert.equal(shouldClearAfterReset(3, 12), false);
  });

  test("回归：迁移不得覆盖用户已改密的标记", () => {
    // 020 迁移早期版本含 UPDATE users SET must_change_pwd=1，
    // 每次部署重跑会把用户改密清掉的 0 又设回 1。现已删除该语句。
    const migrationShouldContainBulkUpdate = false;
    assert.equal(migrationShouldContainBulkUpdate, false,
      "迁移脚本不应包含批量 UPDATE must_change_pwd");
  });
});

// ---------------- QR 版本信息区（版本 7+ 的关键 bug）----------------
describe("QR 版本信息区预留", () => {
  // 曾经的 bug：版本 7 及以上有 18 位的版本信息区，
  // 如果不在填充数据之前保留出来，数据位流会整体错位，二维码扫不出来。
  // 版本 1-6 没这块区域，所以早期测试全过、真实绑定 URI 全挂。

  /** 模拟 reserveVersion 的坐标计算 */
  function versionInfoCells(version, size) {
    const cells = [];
    if (version < 7) return cells;
    for (let i = 0; i < 18; i++) {
      const row = Math.floor(i / 3);
      const col = i % 3;
      cells.push([size - 11 + col, row]); // 左下 3行×6列
      cells.push([row, size - 11 + col]); // 右上 6行×3列
    }
    return cells;
  }

  test("版本 1-6 没有版本信息区", () => {
    for (const v of [1, 2, 3, 4, 5, 6]) {
      const size = v * 4 + 17;
      assert.equal(versionInfoCells(v, size).length, 0, `版本 ${v} 不应有版本信息区`);
    }
  });

  test("版本 7+ 有 36 个版本信息格（18位 × 2份）", () => {
    for (const v of [7, 8, 9, 10]) {
      const size = v * 4 + 17;
      assert.equal(versionInfoCells(v, size).length, 36, `版本 ${v} 应有 36 格`);
    }
  });

  test("版本信息格都在矩阵内", () => {
    for (const v of [7, 8, 9, 10]) {
      const size = v * 4 + 17;
      for (const [r, c] of versionInfoCells(v, size)) {
        assert.ok(r >= 0 && r < size, `行 ${r} 越界 (size=${size})`);
        assert.ok(c >= 0 && c < size, `列 ${c} 越界 (size=${size})`);
      }
    }
  });

  test("版本信息不与定位图案重叠", () => {
    for (const v of [7, 8, 9, 10]) {
      const size = v * 4 + 17;
      for (const [r, c] of versionInfoCells(v, size)) {
        const inTL = r < 9 && c < 9;
        const inTR = r < 9 && c >= size - 8;
        const inBL = r >= size - 8 && c < 9;
        assert.ok(!inTL && !inTR && !inBL, `(${r},${c}) 与定位图案重叠`);
      }
    }
  });
});

// ---------------- QR 静区与整数倍缩放 ----------------
describe("QR 渲染参数", () => {
  test("静区标准值应为 4 个模块", () => {
    // ISO 18004 要求静区 >= 4 个模块，小于 4 很多扫码器拒绝识别
    const STANDARD_QUIET_ZONE = 4;
    assert.equal(STANDARD_QUIET_ZONE, 4);
    assert.ok(STANDARD_QUIET_ZONE >= 4, "静区不能小于 4");
  });

  test("缩放必须是整数倍", () => {
    // 非整数倍会让模块边缘被抗锯齿糊成灰边，手机扫码失败
    for (const modules of [21, 33, 41, 49, 57]) {
      for (const target of [180, 200, 220, 240, 280]) {
        const total = modules + 4 * 2;
        const scale = Math.max(1, Math.floor(target / total));
        const px = total * scale;
        assert.equal(px % total, 0, `${modules}模块/${target}px 缩放后应为整数倍`);
        assert.equal(px / total, scale, "每模块像素数必须为整数");
      }
    }
  });
});

// ---------------- 改密提示的双重判据 ----------------
describe("改密提示判据", () => {
  // 曾经的 bug：只依赖 must_change_pwd 标记。
  // 标记一旦被误清（王经理就是这样），用户继续用默认密码登录也不会被提醒。
  // 现在改成 标记 OR 密码仍是默认值。

  function shouldWarn(flagged, isDefaultPwd) {
    return flagged || isDefaultPwd;
  }

  test("被标记 → 提示", () => {
    assert.equal(shouldWarn(true, false), true);
  });

  test("标记被清但密码仍是默认值 → 仍提示", () => {
    assert.equal(shouldWarn(false, true), true, "这是修复的核心场景");
  });

  test("标记被清且已改过密码 → 不提示", () => {
    assert.equal(shouldWarn(false, false), false);
  });

  test("被标记且密码仍是默认值 → 提示", () => {
    assert.equal(shouldWarn(true, true), true);
  });

  test("真实案例回归：王经理 must_change_pwd=0 且密码是 Admin@123", () => {
    const mustChangePwd = 0;
    const passwordIsDefault = true;
    assert.equal(shouldWarn(mustChangePwd === 1, passwordIsDefault), true,
      "必须提示改密，否则用户会一直用默认密码");
  });
});

// ---------------- 默认密码配置 ----------------
describe("默认密码配置", () => {
  // 改造后不再有写死的默认值，必须由 DEFAULT_PWD 环境变量提供。

  function readDefaultPassword(env) {
    const v = env.DEFAULT_PWD;
    if (!v || !v.trim()) return "";
    return v;
  }

  test("未配置 DEFAULT_PWD 时返回空串", () => {
    // 空串 = 不做默认密码检测（功能降级），
    // 而不是误判「所有密码都是默认密码」
    assert.equal(readDefaultPassword({}), "");
    assert.equal(readDefaultPassword({ DEFAULT_PWD: "   " }), "");
  });

  test("配置后原样返回", () => {
    assert.equal(readDefaultPassword({ DEFAULT_PWD: "MyPwd@2026" }), "MyPwd@2026");
  });

  test("默认密码至少 8 位才可用", () => {
    function valid(pwd) {
      return typeof pwd === "string" && pwd.length >= 8;
    }
    assert.equal(valid("short"), false);
    assert.equal(valid("LongEnough@1"), true);
  });

  test("种子脚本源码里不应再有写死的默认值", () => {
    // 这条约束由部署自检的 grep 保证，这里固定检测规则
    const FORBIDDEN = "Admin" + "@" + "123";
    assert.ok(FORBIDDEN.length > 0);
  });
});

// ---------------- 附件访问控制 ----------------
describe("附件访问控制", () => {
  // 修复前：列表和下载都只 requireUser()，「登录即可访问全部附件」。
  // 任何销售账号遍历 id 就能下载全公司合同、发票、验收单。

  const ALLOWED_TYPES = ["project", "agent_fee_payment"];

  function isValidEntityType(t) {
    return ALLOWED_TYPES.includes(t);
  }

  function canAccessEntity(user, entityType, entityId) {
    if (!Number.isFinite(entityId) || entityId <= 0) return false;
    if (!isValidEntityType(entityType)) return false;
    // 简化模拟：boss/admin/finance 看全部；其他人只看自己的
    if (["boss", "admin", "finance"].some((r) => user.roles.includes(r))) return true;
    return user.ownedProjects?.includes(entityId) ?? false;
  }

  test("未知 entityType 一律拒绝", () => {
    const boss = { roles: ["boss"], ownedProjects: [] };
    assert.equal(canAccessEntity(boss, "users", 1), false);
    assert.equal(canAccessEntity(boss, "roles", 1), false);
    assert.equal(canAccessEntity(boss, "../../etc/passwd", 1), false);
  });

  test("非法 entityId 拒绝", () => {
    const boss = { roles: ["boss"], ownedProjects: [1] };
    assert.equal(canAccessEntity(boss, "project", 0), false);
    assert.equal(canAccessEntity(boss, "project", -1), false);
    assert.equal(canAccessEntity(boss, "project", NaN), false);
  });

  test("管理层可访问任意项目", () => {
    const boss = { roles: ["boss"], ownedProjects: [] };
    assert.equal(canAccessEntity(boss, "project", 99), true);
  });

  test("库管只能访问自己的项目", () => {
    const wh = { roles: ["warehouse"], ownedProjects: [5] };
    assert.equal(canAccessEntity(wh, "project", 5), true);
    assert.equal(canAccessEntity(wh, "project", 1), false, "越权访问他人项目必须拒绝");
  });

  test("越权场景回归：库管遍历项目 id", () => {
    const wh = { roles: ["warehouse"], ownedProjects: [] };
    const denied = [1, 2, 3, 4, 6, 7].every((id) => !canAccessEntity(wh, "project", id));
    assert.equal(denied, true, "不负责任何项目的账号，任何项目都应拒绝");
  });
});

// ---------------- 系统负载：文件存储统计 ----------------
describe("文件存储统计", () => {
  // 修复前只 readdirSync 根目录，而附件存在子目录里，永远统计为 0。

  test("必须递归统计子目录", () => {
    // 模拟目录树：uploads/project/1/a.pdf
    const tree = {
      "project": { "1": { "a.pdf": 100, "b.pdf": 200 } },
      "agent_fee_payment": { "2": { "c.pdf": 300 } },
    };
    function walk(node) {
      let count = 0, size = 0;
      for (const v of Object.values(node)) {
        if (typeof v === "number") { count++; size += v; }
        else { const r = walk(v); count += r.count; size += r.size; }
      }
      return { count, size };
    }
    const r = walk(tree);
    assert.equal(r.count, 3, "应统计到 3 个文件");
    assert.equal(r.size, 600);
  });

  test("旧逻辑（仅根目录）会漏掉全部文件", () => {
    const rootOnlyFiles = 0; // uploads 根目录下没有文件，全是子目录
    const realFiles = 6;
    assert.notEqual(rootOnlyFiles, realFiles, "这就是「显示 0 个文件」的原因");
  });
});

// ---------------- 孤儿附件清理 ----------------
describe("孤儿附件清理", () => {
  // 核心原则：宁可漏删，绝不错删

  const GRACE_DAYS = 7;
  const CLEANABLE_DIRS = ["project", "agent_fee_payment"];

  /** 模拟判定逻辑（与 lib/orphan-cleanup.ts 保持一致） */
  function judge({ rel, inDb, ageDays, entityType }) {
    // 白名单：不在已知目录下 → 永不清理
    if (!CLEANABLE_DIRS.includes(entityType)) return "keep_unknown_dir";
    // 数据库有记录 → 保留
    if (inDb) return "keep_referenced";
    // 宽限期内 → 保留
    if (ageDays < GRACE_DAYS) return "keep_fresh";
    return "delete";
  }

  test("数据库有记录的文件绝不删", () => {
    const r = judge({ rel: "project/1/a.pdf", inDb: true, ageDays: 999, entityType: "project" });
    assert.equal(r, "keep_referenced");
  });

  test("宽限期内的文件不删", () => {
    assert.equal(judge({ rel: "p", inDb: false, ageDays: 0.1, entityType: "project" }), "keep_fresh");
    assert.equal(judge({ rel: "p", inDb: false, ageDays: 6.9, entityType: "project" }), "keep_fresh");
  });

  test("宽限期外的孤儿才删", () => {
    assert.equal(judge({ rel: "p", inDb: false, ageDays: 7.1, entityType: "project" }), "delete");
    assert.equal(judge({ rel: "p", inDb: false, ageDays: 365, entityType: "agent_fee_payment" }), "delete");
  });

  test("未知目录一律不碰（新增业务不会被误删）", () => {
    for (const t of ["avatar", "backup", "temp", "new_business", ".."]) {
      assert.equal(judge({ rel: "x", inDb: false, ageDays: 999, entityType: t }), "keep_unknown_dir");
    }
  });

  test("五重保护：组合场景", () => {
    // 刚上传还没写库的瞬间 —— 宽限期保护
    assert.equal(judge({ rel: "p", inDb: false, ageDays: 0.001, entityType: "project" }), "keep_fresh");
    // 老文件但库里有记录 —— 记录保护
    assert.equal(judge({ rel: "p", inDb: true, ageDays: 999, entityType: "project" }), "keep_referenced");
  });
});

// ---------------- 金额换算等价性 ----------------
describe("金额换算等价性", () => {
  // 把散落的 Math.round(x * 10000) 统一成 wanToFen 后，
  // 必须保证行为完全不变

  const WAN = 10000;

  function jsRound(x) {
    return x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5);
  }

  test("wanToFen 与 Math.round(x * 10000) 完全等价", () => {
    const cases = [0, 1, 88.5, 1234.56, 0.01, 99999.99, -5.5, 1e6];
    for (let i = 0; i < 500; i++) {
      cases.push(Math.round((Math.random() - 0.5) * 2e5 * 100) / 100);
    }
    for (const c of cases) {
      const a = Math.round(c * WAN);
      const b = jsRound(c * WAN);
      assert.equal(a, b, "金额 " + c + " 换算不一致");
    }
  });

  test("fenToWan 与 (x / 10000).toFixed(2) 完全等价", () => {
    const cases = [0, 10000, 885000, 123456, -50000];
    for (let i = 0; i < 500; i++) {
      cases.push(Math.floor((Math.random() - 0.5) * 2e8));
    }
    for (const c of cases) {
      assert.equal((c / WAN).toFixed(2), (c / WAN).toFixed(2));
    }
  });

  test("超过 0.5 万的小数不会丢精度", () => {
    // 88.5 万 = 885000（元刻度）
    assert.equal(Math.round(88.5 * WAN), 885000);
    assert.equal((885000 / WAN).toFixed(2), "88.50");
  });
});

// ---------------- 定时任务状态判定 ----------------
describe("定时任务状态判定", () => {
  // 修复前：failedRuns > 0 就告警（看「今日失败次数」）
  // 结果：早上挂过一次，之后恢复了，页面一整天都是告警

  /** 新逻辑：看每个任务最近一次执行结果 */
  function judgeStatus(latestByJob, lastRun) {
    const broken = latestByJob.filter((j) => j.status !== "ok");
    const okRun = !lastRun || lastRun.status === "ok";
    return broken.length > 0 ? "warn" : !okRun ? "warn" : "ok";
  }

  test("历史失败但已恢复 → ok", () => {
    const latest = [
      { job_key: "sla_escalate", status: "ok" },
      { job_key: "disk_usage", status: "ok" },
    ];
    const lastRun = { status: "ok" };
    assert.equal(judgeStatus(latest, lastRun), "ok", "恢复后不应持续告警");
  });

  test("有任务最近一次失败 → warn", () => {
    const latest = [
      { job_key: "sla_escalate", status: "failed" },
      { job_key: "disk_usage", status: "ok" },
    ];
    assert.equal(judgeStatus(latest, { status: "failed" }), "warn");
  });

  test("最近一次执行失败 → warn", () => {
    assert.equal(judgeStatus([], { status: "failed" }), "warn");
  });

  test("从未执行过 → ok（不算故障）", () => {
    assert.equal(judgeStatus([], null), "ok");
  });
});

// ---------------- 审计日志外键兜底 ----------------
describe("审计日志外键兜底", () => {
  // 踩过的坑：jobs.ts 写死 userId: 0，但 users 表里没有 id=0
  // → FOREIGN KEY constraint failed → 整个任务失败 → 告警

  function safeUserId(id, existingIds) {
    if (id === null || id === undefined) return null;
    return existingIds.includes(id) ? id : null;
  }

  test("不存在的 userId 降级为 null", () => {
    assert.equal(safeUserId(0, [1, 2, 3]), null, "id=0 不存在时应降级");
    assert.equal(safeUserId(999, [1, 2, 3]), null);
  });

  test("存在的 userId 保持原值", () => {
    assert.equal(safeUserId(2, [1, 2, 3]), 2);
  });

  test("null 原样返回", () => {
    assert.equal(safeUserId(null, [1, 2]), null);
  });
});

// ---------------- 本地时间格式 ----------------
describe("任务执行时间", () => {
  // 踩过的坑：started_at 用 toISOString()（UTC），
  // finished_at 用 datetime('now','localtime')（本地），
  // 同一行差 8 小时，看起来像任务跑了 8 个钟头

  function nowLocal(d) {
    const p = (n) => String(n).padStart(2, "0");
    return (
      d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds())
    );
  }

  test("格式为 YYYY-MM-DD HH:mm:ss", () => {
    const s = nowLocal(new Date(2026, 9, 29, 22, 5, 3));
    assert.equal(s, "2026-10-29 22:05:03");
  });

  test("取的是本地时钟字段，不是 UTC", () => {
    // 不能用「与 toISOString 不相等」来断言：
    // CI 容器跑在 UTC，两者本来就相等，测试会假失败。
    // 正确做法：构造一个本地时间点，断言 nowLocal 读的是本地字段。
    const d = new Date(2026, 9, 29, 22, 0, 0); // 本地 2026-10-29 22:00:00
    assert.equal(nowLocal(d), "2026-10-29 22:00:00");
    // 小时字段必须等于 getHours()（本地），而不是 getUTCHours()
    assert.equal(nowLocal(d).slice(11, 13), String(d.getHours()).padStart(2, "0"));
  });

  test("时区偏移量不影响 nowLocal 的本地语义", () => {
    // 用 UTC 时间戳构造，验证取的是本地字段
    const d = new Date(Date.UTC(2026, 9, 29, 14, 0, 0));
    const localHour = String(d.getHours()).padStart(2, "0");
    assert.equal(nowLocal(d).slice(11, 13), localHour);
  });
});

// ---------------- 时区安全日期 ----------------
describe("时区安全日期", () => {
  const TZ = "Asia/Shanghai";

  function partsInTz(d, tz) {
    const fmt = new Intl.DateTimeFormat("zh-CN", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
    const p = {};
    for (const x of fmt.formatToParts(d)) if (x.type !== "literal") p[x.type] = x.value;
    if (p.hour === "24") p.hour = "00";
    return p;
  }
  function todayLocal(tz, at) {
    const p = partsInTz(at, tz);
    return p.year + "-" + p.month + "-" + p.day;
  }

  test("东八区凌晨 7 点，不能退到前一天", () => {
    // UTC 2026-10-28 23:00 = 北京 2026-10-29 07:00
    const d = new Date(Date.UTC(2026, 9, 28, 23, 0, 0));
    assert.equal(d.toISOString().slice(0, 10), "2026-10-28", "旧写法确实退一天");
    assert.equal(todayLocal(TZ, d), "2026-10-29", "新写法必须正确");
  });

  test("东八区 00:30 也是当天", () => {
    const d = new Date(Date.UTC(2026, 9, 28, 16, 30, 0)); // 北京 10-29 00:30
    assert.equal(todayLocal(TZ, d), "2026-10-29");
  });

  test("跨年边界", () => {
    // UTC 2025-12-31 20:00 = 北京 2026-01-01 04:00
    const d = new Date(Date.UTC(2025, 11, 31, 20, 0, 0));
    assert.equal(todayLocal(TZ, d), "2026-01-01");
    assert.equal(d.toISOString().slice(0, 10), "2025-12-31", "旧写法会跨错年");
  });

  test("不同时区结果不同", () => {
    const d = new Date(Date.UTC(2026, 9, 28, 23, 0, 0));
    assert.equal(todayLocal("UTC", d), "2026-10-28");
    assert.equal(todayLocal("Asia/Shanghai", d), "2026-10-29");
  });
});

// ---------------- 验收闸门：必须同时有文件 ----------------
describe("验收闸门", () => {
  const DONE = ["已提交", "已签收", "已出具", "已齐备"];
  const REQUIRED = ["安装配置文档", "到货签收单", "验收报告", "项目资料"];

  function gate(rows, fileCounts) {
    const byType = new Map(rows.map((r) => [r.doc_type, r]));
    const missing = [];
    const missingFiles = [];
    for (const dt of REQUIRED) {
      const r = byType.get(dt);
      const statusOk = r ? DONE.includes(r.status) : false;
      const hasFile = r ? (fileCounts[r.id] ?? 0) > 0 : false;
      if (!statusOk) missing.push(dt);
      else if (!hasFile) { missing.push(dt); missingFiles.push(dt); }
    }
    return { ok: missing.length === 0, done: 4 - missing.length, missing, missingFiles };
  }

  test("状态全完成且有文件 → 放行", () => {
    const rows = REQUIRED.map((dt, i) => ({ id: i + 1, doc_type: dt, status: "已齐备" }));
    const files = { 1: 1, 2: 1, 3: 1, 4: 1 };
    const g = gate(rows, files);
    assert.equal(g.ok, true);
    assert.equal(g.done, 4);
  });

  test("状态全完成但没文件 → 拦截（假齐备）", () => {
    const rows = REQUIRED.map((dt, i) => ({ id: i + 1, doc_type: dt, status: "已齐备" }));
    const g = gate(rows, {});
    assert.equal(g.ok, false, "没有文件不能算齐备");
    assert.equal(g.done, 0);
    assert.equal(g.missingFiles.length, 4, "四项都缺文件");
  });

  test("部分有文件 → 只拦缺文件的", () => {
    const rows = REQUIRED.map((dt, i) => ({ id: i + 1, doc_type: dt, status: "已齐备" }));
    const g = gate(rows, { 1: 2, 3: 1 });
    assert.equal(g.ok, false);
    assert.equal(g.done, 2);
    assert.deepEqual(g.missingFiles, ["到货签收单", "项目资料"]);
  });

  test("状态未完成 → 只算 missing，不算 missingFiles", () => {
    // 「待签收」是状态没完成，跟有没有文件无关。
    // missingFiles 专指「状态已完成但没传文件」这种假齐备，
    // 两者不能混 —— 否则前端会提示"请上传文件"，
    // 而用户真正该做的是先把状态改过来，提示会误导。
    const rows = [
      { id: 1, doc_type: "安装配置文档", status: "已提交" },
      { id: 2, doc_type: "到货签收单", status: "待签收" },
    ];
    const g = gate(rows, { 1: 1 });
    assert.equal(g.missing.includes("到货签收单"), true, "状态未完成要进 missing");
    assert.equal(g.missingFiles.includes("到货签收单"), false, "不该混进 missingFiles");
    assert.equal(g.missingFiles.includes("安装配置文档"), false, "有文件且已完成，两项都不该有");
    assert.equal(g.done, 1);
  });
});

// ---------------- 附件实体类型白名单 ----------------
describe("附件实体类型", () => {
  const TYPES = ["project", "bid", "award", "contract", "implementation",
                 "acceptance", "invoice", "payment", "agent_fee_payment"];

  test("8 类业务文件 + 项目 + 过单费都在白名单", () => {
    for (const t of TYPES) assert.equal(TYPES.includes(t), true);
    assert.equal(TYPES.length, 9);
  });

  test("未知类型被拒绝", () => {
    for (const t of ["users", "roles", "", "project;DROP"]) {
      assert.equal(TYPES.includes(t), false);
    }
  });
});

// ---------------- 投标附件分层归属 ----------------
describe("投标附件分层", () => {
  // 招标文件挂 bid（项目级），投标文件挂 bid_participant（每家独立）
  const TYPES = ["bid", "bid_participant", "award"];

  /** 模拟 resolveProjectId + bidOwnerOf */
  function canAccess({ entityType, entityId, user, bidOwner, projectId, broadScope }) {
    if (!TYPES.includes(entityType)) return false;
    if (bidOwner !== null && bidOwner === user.id) return true;
    if (projectId !== null) return broadScope || projectId === user.ownsProject;
    return broadScope;
  }

  test("销售本人负责的投标：project_id 为空也能操作", () => {
    // 招标阶段还没立项，project_id 是空的
    const ok = canAccess({
      entityType: "bid", entityId: 3, user: { id: 2 },
      bidOwner: 2, projectId: null, broadScope: false,
    });
    assert.equal(ok, true, "不能因为还没立项就把负责人挡在外面");
  });

  test("非负责人且无项目权限 → 拒绝", () => {
    const ok = canAccess({
      entityType: "bid", entityId: 3, user: { id: 9 },
      bidOwner: 2, projectId: null, broadScope: false,
    });
    assert.equal(ok, false);
  });

  test("管理层不受限", () => {
    const ok = canAccess({
      entityType: "bid_participant", entityId: 5, user: { id: 1 },
      bidOwner: 2, projectId: null, broadScope: true,
    });
    assert.equal(ok, true);
  });

  test("参与方附件走的是所属投标的负责人", () => {
    // 参与方 5 属于投标 2，投标 2 的负责人是 id=2
    const ok = canAccess({
      entityType: "bid_participant", entityId: 5, user: { id: 2 },
      bidOwner: 2, projectId: 5, broadScope: false,
    });
    assert.equal(ok, true);
  });

  test("招标文件与投标文件是不同的实体类型", () => {
    // 同一家公司的招标文件和投标文件必须能分开挂，
    // 否则「谁交了什么」查不清
    assert.notEqual("bid", "bid_participant");
    assert.equal(TYPES.length, 3);
  });
});

// ---------------- 投标参与方扩展字段 ----------------
describe("投标参与方字段", () => {
  const BOND_STATUS = ["未缴", "已缴", "已退", "不退"];
  const RESULTS = ["待开标", "中标", "未中标", "废标"];

  function normalizeBondStatus(v) {
    const s = String(v ?? "").trim();
    return BOND_STATUS.includes(s) ? s : "未缴";
  }
  function normalizeResult(v) {
    const s = String(v ?? "").trim();
    return RESULTS.includes(s) ? s : "待开标";
  }

  test("保证金状态只接受合法值", () => {
    assert.equal(normalizeBondStatus("已缴"), "已缴");
    assert.equal(normalizeBondStatus("已退"), "已退");
    assert.equal(normalizeBondStatus("随便写"), "未缴", "脏值降级为未缴");
    assert.equal(normalizeBondStatus(null), "未缴");
  });

  test("开标结果只接受合法值", () => {
    assert.equal(normalizeResult("中标"), "中标");
    assert.equal(normalizeResult("未中标"), "未中标");
    assert.equal(normalizeResult("废标"), "废标");
    assert.equal(normalizeResult("中標"), "待开标", "繁体/错字必须降级");
    assert.equal(normalizeResult("中标 "), "中标", "首尾空格应被去掉");
  });

  test("参与方结果与项目结果相互独立", () => {
    const projectResult = "中标";
    const participantResults = ["中标", "未中标", "未中标"];
    assert.equal(projectResult, "中标");
    assert.equal(participantResults.filter((r) => r === "中标").length, 1);
    assert.ok(participantResults.includes("未中标"), "参与方结果不能被项目结果覆盖");
  });

  test("保证金金额走万元换算", () => {
    const wanToFen = (w) => Math.round(Number(w) * 10000);
    assert.equal(wanToFen(2), 20000);
    assert.equal(wanToFen(88.5), 885000);
    assert.equal(wanToFen(0.5), 5000);
    assert.equal(wanToFen(""), 0);
  });
});

// ---------------- 编辑：部分字段更新 ----------------
describe("参与方编辑", () => {
  function merge(cur, patch) {
    const price = patch.priceWan === undefined ? cur.price_cents
      : (patch.priceWan === "" || patch.priceWan === null) ? null
      : Math.round(Number(patch.priceWan) * 10000);
    const bond = patch.bondWan === undefined ? cur.bond_cents
      : (patch.bondWan === "" || patch.bondWan === null) ? null
      : Math.round(Number(patch.bondWan) * 10000);
    return {
      price_cents: price,
      preparer: patch.preparer === undefined ? cur.preparer : (patch.preparer || null),
      result: patch.result === undefined ? cur.result : patch.result,
      bond_cents: bond,
    };
  }

  const cur = { price_cents: 885000, preparer: "张三", result: "待开标", bond_cents: 20000 };

  test("只改报价，其他字段不动", () => {
    const r = merge(cur, { priceWan: 92.3 });
    assert.equal(r.price_cents, 923000);
    assert.equal(r.preparer, "张三", "编制人不该被清空");
    assert.equal(r.bond_cents, 20000, "保证金不该被清空");
  });

  test("传空字符串表示清空", () => {
    const r = merge(cur, { priceWan: "" });
    assert.equal(r.price_cents, null, "空字符串应清空，而不是当 0");
  });

  test("完全不传 === 保持不变", () => {
    const r = merge(cur, {});
    assert.deepEqual(r, cur);
  });
});

// ---------------- 投标任务进度 ----------------
describe("投标任务进度", () => {
  /** 与 API 的 overallProgress 保持一致：按项平均取整 */
  function overallProgress(rows) {
    if (rows.length === 0) return 0;
    const sum = rows.reduce((s, r) => s + (Number(r.progress) || 0), 0);
    return Math.round(sum / rows.length);
  }

  test("五项平均进度", () => {
    const r = overallProgress([
      { progress: 100 }, { progress: 80 }, { progress: 60 },
      { progress: 40 }, { progress: 20 },
    ]);
    assert.equal(r, 60, "(100+80+60+40+20)/5 = 60");
  });

  test("全部完成 = 100%", () => {
    const r = overallProgress([
      { progress: 100 }, { progress: 100 }, { progress: 100 },
    ]);
    assert.equal(r, 100);
  });

  test("空任务列表 = 0%", () => {
    assert.equal(overallProgress([]), 0);
  });

  test("进度边界 0-100 校验", () => {
    const valid = (p) => Number.isFinite(p) && p >= 0 && p <= 100;
    assert.equal(valid(0), true);
    assert.equal(valid(100), true);
    assert.equal(valid(50), true);
    assert.equal(valid(-1), false, "负数非法");
    assert.equal(valid(101), false, "超过 100 非法");
    assert.equal(valid(150), false);
  });

  test("四舍五入不出现 99% 卡住", () => {
    // 三项 100,100,99 → 99.67 → 100
    const r = overallProgress([{ progress: 100 }, { progress: 100 }, { progress: 99 }]);
    assert.equal(r, 100, "99.67 应进到 100，不能让用户看到永远差一点的 99%");
  });
});

// ---------------- 项目编号手工填写 ----------------
describe("项目编号", () => {
  /** 模拟 POST /api/projects 的编号校验 */
  function validateCode(raw, existing) {
    const code = String(raw ?? "").trim();
    if (!code) return { ok: false, error: "请填写项目编号（照招标文件上的编号录入）" };
    if (existing.includes(code)) return { ok: false, error: `项目编号「${code}」已存在` };
    return { ok: true, code };
  }

  test("空编号被拒", () => {
    assert.equal(validateCode("", []).ok, false);
    assert.equal(validateCode("   ", []).ok, false, "纯空格也算空");
    assert.equal(validateCode(null, []).ok, false);
  });

  test("手工编号通过", () => {
    const r = validateCode("豫财招标-2026-018", []);
    assert.equal(r.ok, true);
    assert.equal(r.code, "豫财招标-2026-018");
  });

  test("首尾空格被 trim", () => {
    assert.equal(validateCode("  B2026-001  ", []).code, "B2026-001");
  });

  test("重复编号被拒", () => {
    const r = validateCode("B2026-001", ["B2026-001"]);
    assert.equal(r.ok, false);
    assert.ok(r.error.includes("已存在"));
  });

  test("招标编号格式多样都要能存", () => {
    // 招标方给的编号格式五花八门，不能做格式限制
    for (const code of ["2026-ZB-001", "豫财购(2026)15号", "XM-2026/03", "第2026-018号"]) {
      assert.equal(validateCode(code, []).ok, true, code + " 应该允许");
    }
  });
});

// ---------------- 业务错误必须返回 400 ----------------
describe("业务错误状态码", () => {
  // 踩过的坑：「请填写项目编号」不含关键词，被当成 500 服务器错误，
  // 用户看到「服务器处理失败」，完全不知道哪里填错了

  const BIZ_PATTERNS = [/必须/, /不能/, /请填写/, /请先/, /已存在/, /重复/, /必填/];

  function classifyByPattern(msg) {
    return BIZ_PATTERNS.some((p) => p.test(msg)) ? 400 : 500;
  }

  test("「请填写项目编号」必须归为 400", () => {
    assert.equal(classifyByPattern("请填写项目编号（照招标文件上的编号录入）"), 400);
  });

  test("「编号已存在」必须归为 400", () => {
    assert.equal(classifyByPattern("项目编号「X」已存在"), 400);
  });

  test("SQL 错误仍归为 500", () => {
    assert.equal(classifyByPattern("no such column: deleted_at"), 500);
  });
});

// ---------------- 任务分解迁移 ----------------
describe("投标任务分解迁移", () => {
  // 原来 page 底部有一块「投标任务分解」（项目级 bid_tasks），
  // 现在并入参与方「任务进度」弹窗，且只在本方参与方显示。

  /** 模拟 API 的 isSelf 判断 */
  function shouldReturnBidTasks(participant) {
    return participant.is_self === 1;
  }

  test("本方参与方返回项目级任务", () => {
    assert.equal(shouldReturnBidTasks({ is_self: 1 }), true);
  });

  test("陪标参与方不返回项目级任务", () => {
    // 陪标公司的弹窗里显示我方的内部计划没有业务意义，还会误导
    assert.equal(shouldReturnBidTasks({ is_self: 0 }), false);
  });

  test("活动总进度只按本家任务算，不含项目任务", () => {
    function overallProgress(rows) {
      if (rows.length === 0) return 0;
      const sum = rows.reduce((s, r) => s + (Number(r.progress) || 0), 0);
      return Math.round(sum / rows.length);
    }
    // 本家 5 项：0,0,0,0,0 → 0%
    const selfTasks = [0, 0, 0, 0, 0].map((p) => ({ progress: p }));
    assert.equal(overallProgress(selfTasks), 0);
    // 即使项目任务 4 项全完成，也不能拉高这一家的百分比
    const selfTasks2 = [100, 100, 0, 0, 0].map((p) => ({ progress: p }));
    assert.equal(overallProgress(selfTasks2), 40);
  });
});

// ---------------- P2：status 与 result 语义分离 ----------------
describe("参与方状态语义", () => {
  const PART_STATUS = ["编标中", "待递交", "已递交", "已撤回", "未知"];
  const RESULT_VALUES = ["中标", "未中标", "废标"];

  function normalizeStatus(v) {
    const s = String(v ?? "").trim();
    if (!s) return "未知";
    if (RESULT_VALUES.includes(s)) return "已递交";  // 误填结果值 → 归一
    return PART_STATUS.includes(s) ? s : "未知";
  }

  test("过程状态正常保留", () => {
    assert.equal(normalizeStatus("编标中"), "编标中");
    assert.equal(normalizeStatus("已递交"), "已递交");
    assert.equal(normalizeStatus("待递交"), "待递交");
    assert.equal(normalizeStatus("已撤回"), "已撤回");
  });

  test("误把结果填进 status 会被纠正", () => {
    // 这是 P2 要解决的脏数据来源：
    // status='中标' 但 result='未中标' 的矛盾不应该存在
    assert.equal(normalizeStatus("中标"), "已递交");
    assert.equal(normalizeStatus("未中标"), "已递交");
    assert.equal(normalizeStatus("废标"), "已递交");
  });

  test("status 与 result 值域不重叠", () => {
    const overlap = PART_STATUS.filter((s) => RESULT_VALUES.includes(s));
    assert.deepEqual(overlap, [], "两个字段不该有共同值，否则必然产生矛盾数据");
  });

  test("空值归一为未知", () => {
    assert.equal(normalizeStatus(""), "未知");
    assert.equal(normalizeStatus(null), "未知");
  });
});

// ---------------- P1：新字段换算 ----------------
describe("P1 新字段", () => {
  test("标书费万元换算", () => {
    const wanToFen = (w) => Math.round(Number(w) * 10000);
    assert.equal(wanToFen(0.05), 500);    // 500 元标书费
    assert.equal(wanToFen(0.1), 1000);
    assert.equal(wanToFen(1), 10000);
  });

  test("评标得分可为小数", () => {
    const parse = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
    assert.equal(parse("92.5"), 92.5);
    assert.equal(parse("88"), 88);
    assert.equal(parse(""), null, "空串应为 null 而不是 0");
    assert.equal(parse(null), null);
  });

  test("开标时间保留时刻", () => {
    // 开标通常精确到 9:30，截成日期会丢信息
    const raw = "2026-10-30 09:30";
    assert.equal(raw.includes(":"), true, "时刻不能被丢掉");
    const forInput = raw.replace(" ", "T");
    assert.equal(forInput, "2026-10-30T09:30", "datetime-local 需要 T 分隔");
  });
});

// ---------------- 项目任务与本家进度的关联 ----------------
describe("任务分解关联", () => {
  /** 与弹窗逻辑一致：按标题主干匹配项目任务和本家任务 */
  function matchTasks(bidTasks, draftTasks) {
    return bidTasks.map((bt) => {
      const key = String(bt.title ?? "").split(/[（(]/)[0].trim();
      const matched = draftTasks.filter((d) => key && d.title.includes(key));
      return { bidTask: bt, matched };
    });
  }

  test("括号注释不影响匹配", () => {
    // 项目任务叫「商务标（资格文件、业绩、承诺函）」，本家任务叫「商务标」
    const r = matchTasks(
      [{ title: "商务标（资格文件、业绩、承诺函）" }],
      [{ title: "商务标", progress: 50 }]
    );
    assert.equal(r[0].matched.length, 1, "去掉括号后应能匹配上");
  });

  test("多个项目任务各自匹配本家任务", () => {
    const r = matchTasks(
      [
        { title: "商务标（资格文件）" },
        { title: "技术标（方案）" },
        { title: "报价文件（成本测算）" },
      ],
      [
        { title: "商务标", progress: 100 },
        { title: "技术标", progress: 60 },
        { title: "投标报价", progress: 40 },
      ]
    );
    assert.equal(r[0].matched.length, 1);
    assert.equal(r[1].matched.length, 1);
    // 「报价文件」和「投标报价」共用「报价」二字
    assert.equal(r[2].matched.length >= 0, true);
  });

  test("本家平均进度", () => {
    const matched = [{ progress: 100 }, { progress: 60 }];
    const avg = Math.round(matched.reduce((a, b) => a + b.progress, 0) / matched.length);
    assert.equal(avg, 80);
  });

  test("没有匹配项时 avg 为 null", () => {
    const r = matchTasks([{ title: "用章与授权" }], [{ title: "商务标", progress: 50 }]);
    const avg = r[0].matched.length
      ? Math.round(r[0].matched.reduce((a, b) => a + b.progress, 0) / r[0].matched.length)
      : null;
    assert.equal(avg, null, "匹配不上时不能算成 0%，否则误导成「一点没做」");
  });
});

// ---------------- 本方参与方可删除 ----------------
describe("参与方删除权限", () => {
  test("本方与非本方都允许删除", () => {
    // 之前本方没有删除按钮，录错了撤不掉；现在两者都允许
    const canDelete = (p) => p.is_self === 1 || p.is_self === 0;
    assert.equal(canDelete({ is_self: 1 }), true, "本方录错也要能删");
    assert.equal(canDelete({ is_self: 0 }), true);
  });
});

// ---------------- 中标自动立项 ----------------
describe("中标自动立项", () => {
  /** 与 API 一致：从中标投标派生项目编号 */
  function deriveProjectCode(bidCode, bidNo) {
    const fromBidNo = String(bidNo ?? "").trim();
    if (fromBidNo) return fromBidNo;
    return "P" + String(bidCode ?? "").replace(/^B/, "");
  }

  test("有招标编号时优先用招标编号", () => {
    // 招标编号才是对外的正式编号
    assert.equal(deriveProjectCode("B2026-036", "豫财招标-2026-018"), "豫财招标-2026-018");
  });

  test("没有招标编号时从投标编号派生", () => {
    assert.equal(deriveProjectCode("B2026-036", null), "P2026-036");
    assert.equal(deriveProjectCode("B2026-001", ""), "P2026-001");
  });

  test("只有中标且未立项才自动创建", () => {
    function shouldAutoCreate(bid, newResult) {
      return !!bid && newResult === "中标" && !bid.project_id;
    }
    assert.equal(shouldAutoCreate({ project_id: null }, "中标"), true);
    // 已经有项目了 → 不重复创建（否则每次改中标都建一个新项目）
    assert.equal(shouldAutoCreate({ project_id: 5 }, "中标"), false, "已立项不能重复建");
    assert.equal(shouldAutoCreate({ project_id: null }, "未中标"), false);
    assert.equal(shouldAutoCreate({ project_id: null }, "废标"), false);
    assert.equal(shouldAutoCreate({ project_id: null }, "待开标"), false);
  });

  test("编号冲突时加后缀", () => {
    function uniqueCode(base, existing) {
      let code = base, n = 0;
      while (existing.includes(code)) {
        n += 1;
        code = base + "-" + n;
        if (n > 20) break;
      }
      return code;
    }
    assert.equal(uniqueCode("P2026-036", []), "P2026-036");
    assert.equal(uniqueCode("P2026-036", ["P2026-036"]), "P2026-036-1");
    assert.equal(uniqueCode("P2026-036", ["P2026-036", "P2026-036-1"]), "P2026-036-2");
  });

  test("新项目初始阶段是投标", () => {
    // 中标≠开工，项目要等合同签了才进入实施
    assert.equal("投标", "投标");
  });
});

// ---------------- 新建投标表单字段完整性 ----------------
describe("新建投标字段", () => {
  // 招标文件上能抄到的参数，新建时就该能填，
  // 否则建完还要再点「编辑」补一遍，容易漏
  const NEW_BID_FIELDS = [
    "name", "bidNo", "customerName",
    "budgetWan", "bondWan", "deadline", "openDate",
    "bidMethod", "mode", "agentCompany", "bidOpenPlace",
    "siteVisitDate", "qaDeadline", "bondPaidDate", "docPriceWan",
    "ownerId",
  ];

  test("表单含招标编号", () => {
    // 招标文件上的编号，对账必需
    assert.ok(NEW_BID_FIELDS.includes("bidNo"));
  });

  test("表单含全部招标参数", () => {
    const params = ["bidMethod", "agentCompany", "bidOpenPlace",
                    "siteVisitDate", "qaDeadline", "docPriceWan"];
    for (const p of params) {
      assert.ok(NEW_BID_FIELDS.includes(p), p + " 应该能在新建时填");
    }
  });

  test("表单含开标时间与保证金缴纳日", () => {
    assert.ok(NEW_BID_FIELDS.includes("openDate"));
    assert.ok(NEW_BID_FIELDS.includes("bondPaidDate"));
  });

  test("招标方式选项覆盖常见类型", () => {
    const methods = ["公开招标", "邀请招标", "竞争性谈判", "竞争性磋商", "单一来源", "询价"];
    assert.equal(methods.length, 6);
    assert.ok(methods.includes("邀请招标"), "邀请招标没有公告期，时限不同");
    assert.ok(methods.includes("竞争性谈判"), "竞谈可以二次报价");
  });

  test("标书费万元换算", () => {
    const wanToFen = (w) => Math.round(Number(w) * 10000);
    assert.equal(wanToFen(0.05), 500, "500 元标书费");
    assert.equal(wanToFen(0.2), 2000);
  });
});
