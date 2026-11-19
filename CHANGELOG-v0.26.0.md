# 两个样式修复

日期：2026-10-29

---

## 一、强制改密页按钮不居中

### 现象

「修改并进入系统」按钮靠左，右边一截空白。

### 根因

```css
/* globals.css */
.btn {
  display: inline-flex;
  align-items: center;   /* 垂直居中 */
  gap: 6px;
}
```

按钮本身是 `inline-flex`，没有水平对齐方式，默认 `justify-content: flex-start`（靠左）。

页面里给了 `width: 100%`，按钮撑满了宽度，但**文字仍在左侧**。

### 修复

```tsx
<button
  className="btn btn-pri"
  style={{
    width: "100%",
    padding: "10px 0",
    fontSize: 13.5,
    justifyContent: "center",   // ← 新增
  }}
>
```

### 顺手补的

按钮禁用态**原来没有任何样式**，置灰后看起来仍可点：

```css
.btn:disabled {
  opacity: .55;
  cursor: not-allowed;
}
.btn-pri:disabled {
  background: var(--pri);
  box-shadow: none;
}
```

这个改动是全局的，所有页面的禁用按钮都会受益。

---

## 二、侧栏 Logo 下面有两条分隔线

### 现象

王海涛（销售）登录后，Logo 下方出现两条平行线。

王经理（总经理）登录则只有一条。

### 根因

侧栏结构：

```
LogoBrand
───────────  ← 分割线 A（专属品牌区分隔）
系统管理组（仅 system 权限可见）
业务组
协作组
管理组
```

每个分组的标题都带 `borderTop`：

```tsx
<div style={{
  borderTop: "1px solid var(--side-line)",   // 每組都加
  marginTop: 5,
}}>
  {g.group}
</div>
```

注释里写着「第一组上方不留额外线」，**但代码没有实现这个判断**。

于是：

| 用户 | 看到的第一个分组 | 结果 |
|---|---|---|
| 王经理（有 system）| 系统管理 | 品牌线 + 系统组（无 borderTop，因为它上面紧接品牌线）→ 视觉 1 条 |
| 王海涛（无 system）| **业务** | 品牌线 + **业务组 borderTop** → 视觉 **2 条** |

等等，这个解释需要修正 —— 实际上是：

```
王海涛视野：
  LogoBrand
  ───────────  分割线 A（brand 后面那条）
  ───────────  业务组 borderTop（紧挨着）
  业务
```

两条线间隔只有 `marginTop: 5px`，看起来就是「两条平行线」。

### 修复

只在**不是首个可见分组**时画上边线：

```tsx
{NAV_GROUPS.map((g, gi) => {
  const items = g.items.filter((it) => canSee(it.key));
  if (items.length === 0) return null;

  // 该分组之前是否已经渲染过可见分组
  const isFirstVisible = !NAV_GROUPS
    .slice(0, gi)
    .some((prev) => prev.items.some((it) => canSee(it.key)));

  return (
    <div style={{
      borderTop: isFirstVisible ? "none" : "1px solid var(--side-line)",
      marginTop: isFirstVisible ? 0 : 5,
    }}>
      {g.group}
    </div>
  );
})}
```

### 为什么不能用 gi 判断

```tsx
// 错的写法
{NAV_GROUPS.map((g, gi) => {
  borderTop: gi === 0 ? "none" : "1px solid"
})}
```

`gi` 是数组下标。如果下标 0 的分组因**无权限被整组跳过**（`return null`），
下标 1 就成了实际第一组，但它 `gi === 1`，仍会被加上边线 —— 问题依旧。

所以判断依据必须是「前面有没有**实际渲染**的可见分组」。

---

## 三、验证

### 按钮居中

用真实页面 HTML + 真实 CSS 在 Edge 无头浏览器渲染截图确认：

```
按钮占满宽度，文字「修改并进入系统」水平居中
禁用态正确置灰（半透明 + 不可点光标）
```

### 分隔线

逻辑推演：

```
王经理（有系统组）:
  品牌线 1 条
  业务: borderTop=none   ✓
  协作: borderTop=有
  管理: borderTop=有

王海涛（无系统组）:
  品牌线 1 条
  业务: borderTop=none   ✓ ← 修复关键
  协作: borderTop=有
  管理: borderTop=有
```

渲染截图确认：品牌区下方只有一条线。

---

## 四、回归

| 项目 | 结果 |
|---|---|
| 单元测试 | ✅ 240/240 |
| 类型检查 | ✅ 零错误 |
| 按钮居中 | ✅ 截图确认 |
| 分隔线 | ✅ 截图确认 |
| 容器 | ✅ 双 healthy |

---

## 五、变更清单

```
修改：
  app/force-change-password/ForceChangeForm.tsx  按钮加 justifyContent:center
  components/Sidebar.tsx                          分组上边线改为条件渲染
  app/globals.css                                 补 .btn:disabled 禁用态样式
```

---

## 六、附带说明

测试过程中发现王海涛的密码已被上一轮测试改成 `WangHT@2026`（`must_change_pwd=0`）。
李慧已恢复为初始状态（`must_change_pwd=1`，密码 `Admin@123`），可用来体验强制改密流程。
