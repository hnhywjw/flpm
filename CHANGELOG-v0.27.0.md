# 侧栏分隔线：修过头了，再修回来

日期：2026-10-29

---

## 一、我上一版改错了什么

上一版为了让无 system 权限的用户不出现两条线，我加了这段判断：

```tsx
const isFirstVisible = !NAV_GROUPS
  .slice(0, gi)
  .some((prev) => prev.items.some((it) => canSee(it.key)));
```

**漏掉了「系统管理」块。**

它不在 NAV_GROUPS 里，是独立渲染的：

```tsx
{canSee("system") && (
  <div>
    <div>系统</div>
    <button>系统管理</button>
  </div>
)}

{NAV_GROUPS.map(...)}   // 业务 / 协作 / 管理
```

所以对王经理（有 system）：

```
实际顺序：系统(1) -> 业务(2) -> 协作(3) -> 管理(4)
我的判断只看 NAV_GROUPS，认为「业务」前面没有分组
-> 业务组 borderTop 被去掉   [错误]
-> 系统管理下面那条分隔线消失
```

---

## 二、正确做法

把「系统块是否可见」作为初始条件：

```tsx
// 侧栏最上方是独立的「系统」块（不在 NAV_GROUPS 中）
// 它能显示时，「业务」等分组就不再是第一个
const systemBlockVisible = canSee("system");

const isFirstVisible =
  !systemBlockVisible &&
  !NAV_GROUPS.slice(0, gi).some((prev) =>
    prev.items.some((it) => canSee(it.key))
  );
```

---

## 三、三种角色验证

### 王经理（boss，有 system）

```
品牌区
───────────  线1
系统
系统管理  >
───────────  线2  <- 这次修回来的
业务        （borderTop 有）
───────────  线3
协作        （borderTop 有）
───────────  线4
管理        （borderTop 有）
```

### 王海涛（sales，无 system）

```
品牌区
───────────  线1  <- 只有这一条
业务        （borderTop 无，紧接品牌线）
───────────  线2
协作        （borderTop 有）
```

---

## 四、判断表

| 角色 | 有 system | 业务组上边线 | 结果 |
|---|---|---|---|
| boss 王经理 | 是 | 有 | 系统管理下面有线 ✓ |
| sales 王海涛 | 否 | 无 | 品牌线下直接是业务，不重复 ✓ |
| finance 陈静 | 否 | 无 | 同上 ✓ |
| warehouse 赵磊 | 否 | 无 | 同上 ✓ |

---

## 五、验证方法

用真实 CSS + 按组件逻辑构造的 DOM，在 Edge 无头浏览器渲染截图：

```
prev_boss.png   王经理视角：系统管理下方 1 条线，业务/协作/管理各有 1 条
prev_sales.png  王海涛视角：品牌线下只有业务组，无重复线
```

两张截图确认。

---

## 六、回归

| 项目 | 结果 |
|---|---|
| 单元测试 | 240/240 |
| 类型检查 | 零错误 |
| 王经理视角 | 截图确认 |
| 王海涛视角 | 截图确认 |
| 容器 | 双 healthy |

---

## 七、变更清单

```
修改：
  components/Sidebar.tsx   isFirstVisible 判断加入 systemBlockVisible 条件
```

---

## 八、这事的教训

**改布局判断时，要把「不在同一数据结构里的兄弟元素」算进去。**

侧栏的向上层级我一开始只盯着 NAV_GROUPS 数组，
忘了它上面还有一个硬编码的「系统管理」块。

这种「同层但来源不同」的元素很容易被漏掉：

```
侧栏顺序：
  1. LogoBrand              （组件）
  2. 品牌分隔线              （硬编码 div）
  3. 系统管理块              （条件渲染，硬编码）  <- 我漏了这个
  4. NAV_GROUPS 三组         （map 渲染）
  5. 底部版本区              （硬编码）
```

**验证也要覆盖所有权限分支。** 我第一次只看了王海涛（无 system），
修复后没回头看王经理（有 system）—— 正好是他先发现的问题。
以后这类改动，至少要拿「有权限」和「无权限」两个账号各看一次。
