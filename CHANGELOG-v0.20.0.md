# 浅色模式刷新时侧栏闪深色 —— 修复记录

日期：2026-10-29

---

## 一、现象

侧栏设为浅色后，按 F5 刷新页面，导航栏会先闪一下深色再变浅。

```
刷新瞬间          ~100ms 后
┌────────┐        ┌────────┐
│████████│   →    │        │
│█ 深色 █│        │  浅色  │
│████████│        │        │
└────────┘        └────────┘
   闪烁             正常
```

---

## 二、根因：主题在客户端才恢复

### 原来的链路

```
1. 服务端渲染  →  <html data-side="dark">   ← 写死的
2. 浏览器绘制  →  显示深色侧栏        ← 用户看到的第一帧
3. React 水合  →  ThemeProvider 的 useEffect 执行
4. 读 localStorage  →  发现是 light
5. setState    →  <html data-side="light">
6. 重绘        →  变成浅色            ← 用户看到的第二帧
```

**第 2 步到第 6 步之间就是那一闪。**

关键点：`useEffect` 在**首次绘制之后**才执行，这是 React 的设计，不是 bug。

### 还有第二处闪烁

`Logo` 组件和品牌文字也各自用 `useState(true)` + `useEffect` 读 localStorage，
默认 `isDark = true`，同样要等客户端才纠正。

所以实际是**两处同时闪**：侧栏背景色 + Logo 白底块。

---

## 三、修复方案

核心思路：**让首帧就是对的**，不依赖任何 JS 运行时判断。

### 1. `<head>` 里放阻塞式内联脚本

```tsx
<head>
  <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
</head>
```

脚本内容：

```js
(function(){
  try {
    var root = document.documentElement;
    var t = localStorage.getItem("ltc-theme");
    var s = localStorage.getItem("ltc-side");
    var THEMES = ["blue","teal","green","violet","red","gray"];
    if (t && THEMES.indexOf(t) >= 0) root.setAttribute("data-theme", t);
    if (s === "dark" || s === "light") root.setAttribute("data-side", s);
  } catch (e) {}
})();
```

**为什么这样能消除闪烁**：

```
浏览器解析 <head>  →  遇到 <script>（无 defer/async）→ 同步执行
                    →  data-side 立刻变成 light
                    →  <body> 开始解析
                    →  首次绘制时属性已经是对的
```

内联脚本是**渲染阻塞**的，而 `useEffect` 不是。这是本质区别。

### 2. Logo 和品牌文字改为纯 CSS 驱动

```css
/* 深色侧栏：白底圆角块 */
.logo-box{
  background:#fff;
  box-shadow:0 2px 10px rgba(37,99,235,.28), 0 0 0 1px rgba(255,255,255,.1);
}
.logo-box > img{ width:84%; height:84%; }

/* 浅色侧栏：透明、用满尺寸 */
[data-side="light"] .logo-box{
  background:transparent;
  box-shadow:none;
  border-radius:0 !important;
}
[data-side="light"] .logo-box > img{
  width:100%; height:100%;
}
```

品牌文字同理：

```css
.brand-title{ color:#f8fafc; text-shadow:...; }
[data-side="light"] .brand-title{
  color:transparent;
  background:linear-gradient(135deg,#1e40af,#3b82f6,#1d4ed8);
  -webkit-background-clip:text;
}
```

这样 Logo 组件**不再需要任何 hook**，删掉了 `useState` / `useEffect` / `MutationObserver`。

### 3. ThemeProvider 从 DOM 读初始值

```tsx
// 改前：先默认 dark，再在 effect 里恢复
const [side, setSide] = useState("dark");
useEffect(() => { /* 读 localStorage */ }, []);

// 改后：直接读内联脚本已经设好的 DOM 属性
const [side, setSide] = useState<SideMode>(() => {
  if (typeof document === "undefined") return "dark";
  const v = document.documentElement.getAttribute("data-side");
  return v === "light" ? "light" : "dark";
});
```

**为什么必须改**：原来 `useEffect([side])` 会在挂载时把 state 的 `dark` 写回 DOM，
把内联脚本刚设好的 `light` 又覆盖掉，形成「设好→覆盖→再设回」的二次闪烁。

---

## 四、验证

### 时序验证（关键）

```
服务端初始:        data-side=dark
内联脚本执行后:     data-side=light    ← 首帧前已正确
ThemeProvider 读取: side=light          ← 不会覆盖回 dark
```

### 结构验证

| 检查项 | 结果 |
|---|---|
| 主题脚本在 `<head>` 内 | ✅ |
| 脚本位置在 `<body>` 之前 | ✅ (1274 < 1691) |
| 脚本无 defer/async | ✅ |
| CSS 含 `.logo-box` | ✅ |
| CSS 含 `[data-side=light] .logo-box` | ✅ |
| CSS 含 `.brand-title` / `.brand-en` | ✅ |
| 组件中无残留 `localStorage.getItem("ltc-side")` | ✅ 已清空 |
| Logo.tsx 无任何 hook | ✅ |
| ThemeProvider 从 DOM 读初始值 | ✅ |

### 回归

| 项目 | 结果 |
|---|---|
| 单元测试 | ✅ 225/225 |
| 类型检查 | ✅ 零错误 |

---

## 五、完整链路（修复后）

```
1. 服务端渲染  →  <html data-side="dark">
2. <head> 脚本 →  同步读 localStorage → 改为 light
3. 首次绘制    →  浅色        ← 用户第一眼就是对的 ✅
4. React 水合  →  ThemeProvider 读到 light，不覆盖
5. 后续切换    →  正常响应，无闪烁
```

---

## 六、变更清单

```
修改：
  app/layout.tsx                  <head> 加主题初始化内联脚本
  app/globals.css                 新增 .logo-box / .brand-* 的 CSS 规则
  components/Logo.tsx             Logo 与 LogoBrand 改为 CSS 驱动，删除全部 hooks
  components/ThemeProvider.tsx    初始 state 从 DOM 读取
```

---

## 七、这类问题的通用解法

**任何依赖 localStorage 的视觉偏好（主题、字号、折叠状态），都不要用 useEffect 恢复。**

因为 `useEffect` 跑在绘制之后，必然闪一帧。正确做法：

```
1. <head> 内联脚本（阻塞）× 同步设置 DOM 属性或 class
2. CSS 用属性选择器给出正确样式
3. React state 从 DOM 读初始值，不要反向覆盖
```

唯一例外：如果偏好不影响首屏视觉（如「记住上次打开的标签页」），用 useEffect 没问题。
