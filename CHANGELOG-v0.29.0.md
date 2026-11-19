# 品牌字体与立体感

日期：2026-10-29

---

## 一、先说一个坑：只写字体名等于没写

第一版我做了 5 套字体方案对比，结果截图一看 —— **五套长得一模一样**。

原因：

```css
font-family: 'Montserrat', 'Segoe UI', sans-serif;
```

用户电脑上没装 Montserrat，浏览器**静默回退**到 Segoe UI，
我看到的其实是同一个字体渲染了 5 次。

所以：**字体方案必须自托管**，不能只写名字。

---

## 二、字体方案

### 中文：保留系统字体

Windows → 微软雅黑　macOS → 苹方　移动端 → 系统默认

不是不想换，是成本不划算：

| 方案 | 体积 | 说明 |
|---|---|---|
| 思源黑体全量 | 5-10 MB | 只为几个词，浪费 |
| 子集化 | 约 200 KB | 改文案就要重新切 |
| **系统字体** | **0** | 微软雅黑 / 苹方本身质量很好 |

侧栏只有「项目全流程管理系统」7 个字，为它打包整套中文字体不值得。

### 英文：自托管 Montserrat

取自 `@fontsource/montserrat` 的 **latin 子集**：

```
montserrat-latin-500~800-normal.woff2   4 个   75 KB
inter-latin-500~800-normal.woff2        4 个   97 KB
──────────────────────────────────────────────
合计                                          172 KB
```

**为什么选 Montserrat**：

- 几何无衬线，字母轮廓圆润，和 logo 的弧形语言一致
- 大写 P / F 比例舒展，11-12px 时仍清晰
- 对比 Inter：Inter 中性现代但偏硬，Montserrat 更有品牌温度

Inter 也一并打包了，后续正文英文可以用。

---

## 三、立体感：三个层次

### 文字立体

用 5 层 `text-shadow` 叠出来：

```css
text-shadow:
  0 -1px 0 rgba(255,255,255,.35),   /* 顶部反光 */
  0 1px 0 #08203a,                  /* 第一层厚度 */
  0 2px 0 #061729,                  /* 第二层厚度 */
  0 3px 6px rgba(0,0,0,.5),         /* 与背景的距离 */
  0 0 18px rgba(96,165,250,.38);    /* 蓝色光晕 */
```

**为什么不用 `-webkit-text-stroke`**：

描边会均匀加粗四个方向，中文笔画密的地方（如「管理」）会糊成一坨。
只在垂直方向做偏移，小字号下依然干净。

### Logo 立体

六层构成，缺一层就会显得平：

| # | 层 | 作用 |
|---|---|---|
| 1 | 渐变底 `160deg #fff → #eef4fd → #dbe7f8` | 受光面 |
| 2 | 外投影 `0 12px 28px` | 悬浮距离 |
| 3 | 接触阴影 `0 5px 10px` | 贴地实感 |
| 4 | 内高光 `inset 0 2px 1px #fff` | 顶光 |
| 5 | 内暗影 `inset 0 -3px 6px` | 厚度 |
| 6 | 外发光 `0 0 24px` | 融入侧栏 |

图标本身加了 `drop-shadow(0 1.5px 2px ...)`，
避免「图标浮在玻璃上」的割裂感。

### 浅色主题

白底上做文字投影会显脏，所以：

- 深色侧栏 → 文字立体（白字 + 深色厚度 + 蓝光）
- 浅色侧栏 → 渐变裁切文字 + 极淡 drop-shadow

---

## 四、验证

```
/fonts/montserrat-latin-700-normal.woff2   200  18824 bytes
/fonts/inter-latin-700-normal.woff2        200  24356 bytes
/fonts/montserrat-latin-800-normal.woff2   200  19012 bytes

CSS 长度       16566
含 Montserrat  ✓
含 woff2 路径  ✓
含立体阴影      ✓
```

视觉确认：登录页 ProjectFlow 已是 Montserrat 圆润字形；
侧栏 3x 高清截图确认 logo 浮起、中文有厚度、英文有立体。

---

## 五、回归

| 项目 | 结果 |
|---|---|
| 单元测试 | 240/240 |
| 类型检查 | 零错误 |
| 字体可访问 | 6/6 |
| CSS 含字体与阴影 | ✓ |
| 容器 | 双 healthy |

---

## 六、变更清单

```
新增：
  public/fonts/*.woff2                 8 个字体文件（172 KB）

修改：
  app/globals.css        8 条 @font-face
                         .logo-box 六层立体阴影
                         .brand-title / .brand-sub-title 5 层文字阴影
  components/Logo.tsx    精简内联样式，配色交给 CSS
```

---

## 七、备选方案已就位

字体文件里已包含两套，换风格只需改一行：

| 字体 | 风格 | 场景 |
|---|---|---|
| Montserrat（当前）| 几何圆润，有温度 | 通用商务 |
| Inter | 中性现代，偏硬朗 | 数据密集界面 |

```css
font-family: 'Inter', 'Segoe UI', sans-serif;
```

立体强度也可调：去掉 text-shadow 的第 2、3 层（厚度层）即为扁平风。
