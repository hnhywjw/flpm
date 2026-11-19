// 共用小部件
export function Kpi({ label, value, unit, foot, tone }: {
  label: string; value: string | number; unit?: string; foot?: React.ReactNode;
  tone?: "" | "w" | "b" | "o" | "v";
}) {
  return (
    <div className={`kpi ${tone ?? ""}`}>
      <div className="lb">{label}</div>
      <div className="vl">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {foot && <div className="ft">{foot}</div>}
    </div>
  );
}

export function Badge({ children, tone = "gray" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`badge b-${tone}`}>{children}</span>;
}

export function Bar({ pct, tone }: { pct: number; tone?: "ok" | "warn" | "bad" }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div className="bar">
        <i style={{ width: p + "%", background: tone ? `var(--${tone})` : undefined }} />
      </div>
      <span style={{ fontSize: 11.5, color: "var(--muted)", minWidth: 30 }}>{p}%</span>
    </div>
  );
}

export function PageHeader({ title, desc, right }: {
  title: string; desc?: React.ReactNode; right?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
      <div>
        <h1 style={{ fontSize: 20, letterSpacing: 0.2, fontWeight: 700 }}>{title}</h1>
        {desc && <p style={{ fontSize: 12.5, color: "var(--muted)", paddingBottom: 2 }}>{desc}</p>}
      </div>
      {right && <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>{right}</div>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ textAlign: "center", color: "var(--muted)", padding: "34px 0", fontSize: 13 }}>
      {children}
    </div>
  );
}
