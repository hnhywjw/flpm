# 侧栏分割线：中心渐变发光

日期：2026-10-29

---

## 一、需求

分割线从中心往两边加渐变发光。

---

## 二、先做了四种对比

| 方案 | 效果 | 评价 |
|---|---|---|
| A 纯色 1px | 生硬，无过渡 | 现状 |
| B 中心亮两端淡 | 线本身有明暗 | 克制但略平 |
| **C 渐变线 + 光晕** | 中心亮 + 柔和外发光 | **最平衡** |
| D 强光晕 + 亮芯 | 2px 粗线，光斑明显 | 太抢，像霓虹灯 |

C 的核心代码：

```css
background: linear-gradient(90deg,
  transparent 0%,
  var(--side-line) 20%,
  rgba(125,211,252,.65) 50%,   /* 中心最亮 */
  var(--side-line) 80%,
  transparent 100%);
box-shadow: 0 0 8px 1px rgba(96,165,250,.45);
```

---

## 三、但不是所有线都该发光

侧栏有 3 类分割线：

```
1. 品牌区下方            视觉分界，最重要
2. 分组标题之间（3 条）    业务 / 协作 / 管理 的分隔
3. 底部版本区             收尾
```

我把「全部发光」也做出来对比了，结果很明显：

```
全部发光 → 19 个菜单里插了 4 条亮线，
           视线被反复打断，看起来像四个框扣在一起
```

所以最终采用**混搭**：

| 位置 | 类名 | 效果 |
|---|---|---|
| 品牌区下方 | side-divider-glow | 中心亮 + 外发光 |
| 分组标题 / 底部 | side-divider-soft | 中心亮但亮度减半，无光晕 |

**理由**：品牌区是视觉入口，发光能把视线引过去；
分组线只承担「分隔」职责，低调即可。

---

## 四、技术细节

### 为什么用 background-image 而不是 border-top

border 只能是纯色，做不出渐变。所以：

```css
border-top: 1px solid transparent;
background-image: linear-gradient(90deg, transparent, ...);
background-size: 100% 1px;
background-repeat: no-repeat;
```

### 浅色主题

白底上蓝色光晕会显脏，所以：

```css
[data-side="light"] .side-divider-glow{
  box-shadow: none;                 /* 去掉外发光 */
  background: linear-gradient(90deg,
    transparent, var(--side-line) 20%,
    rgba(37,99,235,.28) 50%,        /* 换低饱和蓝 */
    var(--side-line) 80%, transparent);
}
```

---

## 五、验证

用线上真实 CSS 渲染，并做 6 倍纵向放大确认渐变形状：

```
中心最亮 → 向两端平滑淡出到透明
周围一圈柔和光晕（深色主题）
浅色主题自动降级为无光晕 + 低饱和
```

| 项目 | 结果 |
|---|---|
| 单元测试 | 240/240 |
| 类型检查 | 零错误 |
| CSS 含两个类 | 通过 |
| 容器 | 双 healthy |

---

## 六、变更清单

```
修改：
  components/Sidebar.tsx  品牌区线 → .side-divider-glow
                          分组标题线 / 底部分隔 → .side-divider-soft
  app/globals.css         新增两个分割线类（含浅色主题变体）
```

---

## 七、可以继续调的参数

| 想要 | 改动 |
|---|---|
| 光晕更强 | box-shadow 模糊半径 8px → 14px，透明度 .45 → .6 |
| 线更亮 | 中心色 rgba(125,211,252,.65) → .85 |
| 分组线也发光 | 把 .side-divider-soft 换成 .side-divider-glow（不推荐，会花）|
| 完全取消 | 改回 border-top: 1px solid var(--side-line) |
