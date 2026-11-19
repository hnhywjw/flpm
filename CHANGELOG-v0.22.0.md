# 侧栏行距收紧 + 滚动条隐藏

日期：2026-10-29

---

## 一、需求

1. 导航菜单行间距缩小一点
2. 系统管理未展开时，不显示垂直滚动条

---

## 二、为什么会有滚动条

先量了改动前的实际高度：

```
品牌区（Logo + 中文名 + 英文全称）   101px
分隔线                                1px
底部版本区                            64px
nav 内容                             816px
────────────────────────────────
侧栏总高                             981px
```

1080p 屏幕去掉浏览器地址栏/标签栏后，可用高度约 **940px**。
981 > 940，自然出滚动条。

拆开看 nav 里的 816px：

```
内边距            26px
系统标题          37px
系统管理按钮       41px
业务标题          46px
业务 9 项        368px   ← 主要占用
协作标题          46px
协作 3 项        123px
管理标题          46px
管理 2 项         82px
```

单个菜单项 41px，由这几部分组成：

```
padding-top      9px
文字 13.5×1.55  21px
padding-bottom   9px
margin-bottom    2px
─────────────────
合计            41px
```

---

## 三、改动

### 行距收紧

| 项目 | 改前 | 改后 | 单行节省 |
|---|---|---|---|
| 菜单项上下内边距 | 9px | 7px | 4px × 19 项 = 76px |
| 菜单项下边距 | 2px | 1px | 1px × 19 项 = 19px |
| 分组标题上内边距 | 14px | 10px | 4px × 4 组 = 16px |
| 分组标题下内边距 | 7px | 5px | 2px × 4 组 = 8px |
| 分组标题上外边距 | 8px | 5px | 3px × 3 组 = 9px |
| nav 内边距 | 6/20px | 4/14px | 8px |
| 二级菜单项 | 7px | 5px | — |

**总计减少 136px**，单行从 41px 降到 36px。

### 效果

```
nav 内容    816px → 700px
侧栏总高    981px → 865px
```

1080p 可用 940px，865 < 940，**不再溢出**。

---

## 四、滚动条处理（关键）

### 踩的坑

第一版用了 `scrollbar-width: thin`，想让条变细。结果截图一看，
侧栏右边还是一条明显的竖线。

原因：**Chromium 会优先采纳 `scrollbar-width`，覆盖 `::-webkit-scrollbar` 的透明设置。**

```css
/* 这样写，Chromium 里还是会有条 */
.side-nav{ scrollbar-width: thin; }
.side-nav::-webkit-scrollbar-thumb{ background: transparent; }
```

### 正确写法

```css
.side-nav{
  scrollbar-width: none;      /* Firefox */
  -ms-overflow-style: none;   /* 旧 Edge / IE */
}
.side-nav::-webkit-scrollbar{
  width: 0;
  height: 0;
  display: none;              /* Chromium / Safari */
}
```

三个属性都要写，覆盖三大内核。

**滚轮和触控板仍然可以滚动**，只是看不见滚动条。

### 矮屏适配

高度不足 820px 时进一档压缩：

```css
@media (max-height: 820px) {
  .side-nav { padding: 2px 10px 8px !important; }
  /* 英文全称没有信息增量，藏起来给菜单腾空间 */
  .brand-en { display: none !important; }
}

@media (max-height: 720px) {
  /* 版本号区折叠为一行 */
  .side-foot-en { display: none !important; }
}
```

---

## 五、验证（截图实测）

用真实页面 HTML + 真实 CSS，在 Edge 无头浏览器里按不同高度渲染：

| 窗口高度 | 模拟场景 | 结果 |
|---|---|---|
| 940px | 1080p 全屏 | ✅ 无滚动条，19 项全部显示 |
| 820px | 900p 笔记本 | ✅ 无滚动条，英文全称自动隐藏 |
| 660px | 768p 笔记本 | ✅ 无滚动条（仍需滚动，但看不见条）|

三档截图都确认右侧干净，没有竖线。

---

## 六、回归

| 项目 | 结果 |
|---|---|
| 单元测试 | ✅ 231/231 |
| 类型检查 | ✅ 零错误 |
| 王经理登录 | ✅ 200 |
| 5 个页面 | ✅ 全 200 |
| CSS 含 scrollbar-width:none | ✅ |
| CSS 无 scrollbar-width:thin | ✅ |
| CSS 含矮屏适配 | ✅ |

---

## 七、变更清单

```
修改：
  components/Sidebar.tsx    行距收紧（7px 内边距），nav 加 .side-nav 类
  app/globals.css           滚动条彻底隐藏 + 矮屏适配
```

---

## 八、经验

**`scrollbar-width` 和 `::-webkit-scrollbar` 不能混用。**

Chromium 118+ 支持 `scrollbar-width`，且优先级高于 `::-webkit-scrollbar`。
想让滚动条消失，必须用 `scrollbar-width: none`，而不是把它调细或设透明。

**能用布局解决就别用滚动。**

19 个菜单项摆在 940px 里，本来就不该溢出。
收紧行距是治本，隐藏滚动条是兜底 —— 两者都要做。
