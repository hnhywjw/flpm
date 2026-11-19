# 刷新时「报表分析」闪一下 —— 修复记录

日期：2026-10-29

---

## 一、现象

刷新页面时，侧栏的「报表分析」先出现、再消失。

---

## 二、根因

### 权限判断在客户端才生效

```ts
// Sidebar.tsx（修改前）
const [menus, setMenus] = useState<string[] | null>(null);   // 初始 null

const canSee = (key: string) => {
  if (menus === null) return true;   // ← 权限未知时全部放行
  return menus.includes(key);
};
```

时序：

```
1. 服务端渲染  →  menus = null  →  canSee 全返回 true
                  →  HTML 里输出全部 15 个菜单（含报表分析）
2. 浏览器绘制  →  用户看到报表分析
3. useEffect   →  请求 /api/auth/me
4. 接口返回     →  menus = ['dashboard', ...]  没有 reports
5. 重新渲染    →  报表分析被过滤掉 → 消失
6. 下方「管理」组上移 → 视觉上就是「闪了一下」
```

### 为什么偏偏是「报表分析」

看角色配置：

| 角色 | 含 reports |
|---|---|
| boss 总经理 | ✅ |
| finance 财务 | ✅ |
| admin 系统管理员 | ❌ |
| sales 销售 | ❌ |
| pm 项目经理 | ❌ |
| warehouse 库管 | ❌ |
| service 售后 | ❌ |

7 个角色里只有 2 个有报表分析权限，**其余 5 个角色登录都会看到它闪一下**。

而它在「协作」组的**最后一项**，消失后下面整块内容上移，视觉冲击更明显。

### 当前账号情况

```
王经理    boss   → 有 reports，不会闪
管理员    admin  → 无 reports，会闪
王海涛等5位 sales → 无 reports，会闪
陈静      finance → 有 reports，不会闪
```

如果你用王经理登录还看到闪，那是别的原因；
但用 admin / 销售账号登录，就是这个 bug。

---

## 三、修复

核心思路：**把权限判断从客户端前移到服务端**，让首帧就是正确的。

### 1. layout 服务端取权限

```tsx
// app/layout.tsx
export default async function RootLayout({ children }) {
  // 服务端直接读 session，拿到真实菜单权限
  const user = await getCurrentUser().catch(() => null);

  return (
    <html ...>
      <body>
        <AppShell initialMenus={user?.menus ?? null}>{children}</AppShell>
      </body>
    </html>
  );
}
```

### 2. 逐层透传

```tsx
// AppShell.tsx
export function AppShell({ children, initialMenus = null }) {
  return <Sidebar initialMenus={initialMenus} />;
}

// Sidebar.tsx
export function Sidebar({ initialMenus = null }) {
  const [menus, setMenus] = useState(initialMenus);  // 初始值来自服务端
}
```

### 3. 权限未知时保守隐藏

```ts
const canSee = (key: string) => {
  if (menus === null) return false;   // 改：由 true 改为 false
  return menus.includes(key);
};
```

**为什么改成 false**：

原来是「未知就全显示」，导致先多后少的闪烁。
改成「未知就不显示」，最坏情况是少显示几个菜单，
但不会出现「先出现再消失」这种更难受的视觉错误。

实际上 `menus === null` 只在极窄的竞态窗口出现：

```
middleware 检查 cookie  →  没有就跳 /login
                        →  有就放行
layout 读 session       →  通常必成功
```

### 4. 避免重复请求

```ts
useEffect(() => {
  // 服务端已给权限时不必再请求，省一次往返
  if (initialMenus === null) {
    fetch("/api/auth/me")...
  }
  fetch("/api/alerts/count")...
}, [initialMenus]);
```

---

## 四、验证

直接抓服务端返回的 HTML，检查侧栏里有没有「报表分析」。

### 销售账号（王海涛，无 reports 权限）

```
  渲染   工作台
  渲染   项目管理
  渲染   投标管理
  渲染   中标管理
  渲染   合同管理
    -    开票与回款
  渲染   变更与风险
    -    出入库
    -    售后服务
  渲染   审批中心
  渲染   待办预警
    -    报表分析      ← 未渲染
    -    基础数据
    -    操作日志
    -    系统管理

[OK] 报表分析未渲染 —— 首帧即正确，不会再闪
```

### 王经理（boss，有 reports 权限）

```
报表分析是否出现: 是（正确）
渲染菜单数: 15/15
```

### 修复前后对比

| | 服务端首帧 | 接口返回后 | 结果 |
|---|---|---|---|
| 修复前 | 15 项全渲染 | 过滤掉 reports | **闪** |
| 修复后 | 只渲染有权限的 | 不变 | **不闪** |

---

## 五、回归

| 项目 | 结果 |
|---|---|
| 单元测试 | ✅ 231/231 |
| 类型检查 | ✅ 零错误 |
| 王经理登录 + 15 菜单 | ✅ |
| 王海涛登录 + 8 菜单（无 reports）| ✅ |

---

## 六、变更清单

```
修改：
  app/layout.tsx          改为 async，服务端取 getCurrentUser()
  components/AppShell.tsx  新增 initialMenus prop，透传给 Sidebar
  components/Sidebar.tsx   initialMenus 作为初始 state；
                           canSee 未知时返回 false；
                           已有权限时跳过 /api/auth/me 请求
```

---

## 七、这类问题的通用原则

**任何影响首屏内容的数据，都应在服务端取好，不要等客户端。**

客户端请求必然有延迟，延迟期间渲染什么就很关键：

```
选「先显示全部」→ 后面过滤掉 → 用户看到闪烁   ✗
选「先都不显示」→ 后面补充   → 用户看到出现   △
选「服务端一次给对」        → 用户看到终态   ✓
```

前两种都是妥协，只有第三种是真的解决。

这和之前那个主题闪烁是同一类问题：

```
主题闪烁：useEffect 恢复主题 → 首帧深色 → 变浅
菜单闪烁：useEffect 取权限   → 首帧全显示 → 过滤
```

**解法都一样：把「首帧就需要的数据」提到服务端 / 首帧之前。**
