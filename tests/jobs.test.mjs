/**
 * 推送节流逻辑测试
 * 覆盖：为什么不能用「整除」判断周期（这是实际踩过的坑）
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

/** 与 lib/jobs.ts 中 shouldRemind 保持一致的实现 */
function shouldRemind(days, dailyWithin, period) {
  if (days < 0) return false;
  if (days <= dailyWithin) return true;
  const offset = days - dailyWithin;
  return offset % period < 2;
}

describe("推送节流", () => {
  test("未到期不推", () => {
    assert.equal(shouldRemind(-1, 7, 7), false);
  });

  test("阈值内每天都推", () => {
    for (let d = 0; d <= 7; d++) {
      assert.equal(shouldRemind(d, 7, 7), true, `第 ${d} 天应推`);
    }
  });

  test("超阈值后按周期推，不会永远不命中", () => {
    // 这是关键回归测试：旧实现用 days % 7 === 0，
    // 74 天（74%7=4）、120 天（120%7=1）永远不推
    const cases = [74, 120, 15, 30, 100];
    for (const d of cases) {
      // 每一天的判定只依赖自身，不能因为"不是 7 的倍数"就永远 false
      let hitInWindow = false;
      for (let offset = 0; offset < 7; offset++) {
        if (shouldRemind(d + offset, 7, 7)) hitInWindow = true;
      }
      assert.equal(hitInWindow, true, `逾期 ${d} 天起 7 天内应至少推一次`);
    }
  });

  test("逾期 74 天会推", () => {
    // offset = 74 - 7 = 67, 67 % 7 = 4 → 不推（窗口是 0-1）
    // 但 75 天: 68%7=5 不推; 76: 69%7=6 不推; 77: 70%7=0 → 推
    assert.equal(shouldRemind(77, 7, 7), true);
    assert.equal(shouldRemind(78, 7, 7), true);
  });

  test("同一个 7 天周期内不会重复推", () => {
    // 77、78 两天推，79-83 不推，84 再推
    const hits = [];
    for (let d = 77; d <= 85; d++) {
      if (shouldRemind(d, 7, 7)) hits.push(d);
    }
    assert.deepEqual(hits, [77, 78, 84, 85]);
  });

  test("节点超期用 3 天周期", () => {
    assert.equal(shouldRemind(4, 3, 3), true);  // 4-3=1 < 2
    assert.equal(shouldRemind(5, 3, 3), false); // 5-3=2
    assert.equal(shouldRemind(6, 3, 3), true);  // 6-3=3, 3%3=0
  });

  test("质保剩余用 30 天阈值 + 7 天周期", () => {
    assert.equal(shouldRemind(30, 30, 7), true);
    assert.equal(shouldRemind(31, 30, 7), true);  // 31-30=1 < 2
    assert.equal(shouldRemind(33, 30, 7), false); // 33-30=3
    assert.equal(shouldRemind(37, 30, 7), true);  // 37-30=7, 7%7=0
  });

  test("回归：旧实现的整除判断会漏推", () => {
    // 模拟旧实现
    function oldShouldRemind(days, dailyWithin, period) {
      if (days <= 0) return false;
      if (days <= dailyWithin) return true;
      return days % period === 0;
    }
    // 逾期 74 天：旧实现永不推
    assert.equal(oldShouldRemind(74, 7, 7), false);
    assert.equal(oldShouldRemind(120, 7, 7), false);
    // 新实现能推（在窗口内某天）
    assert.equal(shouldRemind(77, 7, 7), true);
  });
});
