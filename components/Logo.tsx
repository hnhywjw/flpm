"use client";

import Image from "next/image";

/**
 * ProjectFlow Logo
 * 品牌图已去白底转透明、裁掉留白
 *
 * 深蓝主体在深色侧栏上对比度不足 → 自动加浅色底衬
 * 侧栏切浅色主题时底衬会自动去掉
 */
export function Logo({
  size = 36,
  onDark,
}: {
  size?: number;
  /** 显式指定是否在深色背景上；不传则自动读取侧栏主题 */
  onDark?: boolean;
}) {
  // 深浅表现改由 CSS 驱动（.logo-box + [data-side="light"] .logo-box）
  //
  // 之前用 JS 读 localStorage 再 setState，服务端渲染读不到存储，
  // 只能先按「深色」输出，客户端再纠正 —— 刷新时会闪一下。
  // 现在首帧属性由 layout 的内联脚本设好，CSS 直接给出正确外观，无闪烁。
  //
  // onDark 仍然保留：登录页背景是浅色，需要显式指定为 false。
  const forced = onDark !== undefined;
  const inner = forced && !onDark ? size : Math.round(size * 0.84);

  return (
    <span
      className={forced ? undefined : "logo-box"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
        // 显式指定时走内联样式（登录页等独立场景）
        ...(forced
          ? {
              background: onDark ? "#fff" : "transparent",
              borderRadius: onDark ? Math.round(size * 0.28) : 0,
              boxShadow: onDark
                ? "0 2px 10px rgba(37,99,235,.28), 0 0 0 1px rgba(255,255,255,.1)"
                : "none",
            }
          : { borderRadius: Math.round(size * 0.28) }),
      }}
    >
      <Image
        src="/logo.png"
        alt="ProjectFlow 项目全流程管理系统"
        width={inner}
        height={inner}
        priority
        style={{
          width: inner,
          height: inner,
          objectFit: "contain",
          display: "block",
        }}
      />
    </span>
  );
}

/**
 * 侧栏品牌区
 *
 * 三层信息，层次分明：
 *   1. 项目全流程管理系统   14.5px / 800  亮白（主标题）
 *   2. ProjectFlow          11.5px / 700  亮蓝（品牌名）
 *   3. Full Lifecycle ...    9.5px / 600  淡蓝（副标题，上方有分隔线）
 *
 * 关于英文全称的设计：
 * 之前用 justify-content: space-between 把每个字符硬撑到等宽，
 * 结果字母间距忽大忽小，看起来很松散、不精致。
 * 现在改为自然字距 + 分隔线，靠「分隔线」建立层次，
 * 而不是靠拉伸字母——这是更稳妥的做法。
 *
 * 深色背景无法用渐变裁切文字（会变暗），
 * 改用「亮白 + 蓝色投影」模拟质感。
 */
export function LogoBrand() {
  return (
    <div style={{ padding: "18px 16px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <Logo size={40} />
        <div style={{ minWidth: 0, lineHeight: 1.2 }}>
          {/* 颜色、立体感、字体都由 CSS 控制（.brand-title / .brand-sub-title），
              这里只留排版属性，方便统一切换主题 */}
          <div className="brand-title" style={{
            fontSize: 14.5,
            fontWeight: 800,
            letterSpacing: 0.4,
            whiteSpace: "nowrap",
          }}>
            项目全流程管理系统
          </div>
          {/* ProjectFlow 用自托管 Montserrat，字距由 CSS 设为 1.8px */}
          <div className="brand-sub-title" style={{
            fontSize: 12,
            fontWeight: 700,
            marginTop: 4,
            whiteSpace: "nowrap",
          }}>
            ProjectFlow
          </div>
        </div>
      </div>

      {/*
        英文全称
        - 无分隔线（去掉视觉噪音）
        - 左右边界与上方「Logo 左边缘 ~ 中文名右边缘」对齐
        - 用 space-between 让字符均匀分布填满，配小字号保证字母间距自然
      */}
      <div className="brand-en" style={{
        width: "100%",
        marginTop: 9,
        fontSize: 8.5,
        fontWeight: 600,
        lineHeight: 1.5,
        display: "flex",
        justifyContent: "space-between",
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}>
        {"Full Lifecycle Project Management".split("").map((ch, i) => (
          <span key={i}>{ch === " " ? "\u00A0" : ch}</span>
        ))}
      </div>
    </div>
  );
}
