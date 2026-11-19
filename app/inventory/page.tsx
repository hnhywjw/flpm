import { listStock, listStockMoves, getStockAlerts } from "@/lib/queries";
import { Badge, PageHeader, Kpi } from "@/components/ui";
import { NewStockMoveButton } from "./NewStockMoveButton";
import { RowActions } from "@/components/RowActions";
import { guardPage } from "@/lib/page-guard";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  await guardPage("inventory");
  const stock = listStock();
  const moves = listStockMoves();
  const alerts = getStockAlerts();
  const pendingOut = moves.filter((m) => m.status === "待审批" || m.status === "部分到货");

  return (
    <>
      <PageHeader
        title="出入库管理"
        desc={`库存品类 ${stock.length} · 库存预警 ${alerts.length} 项`}
        right={<NewStockMoveButton />}
      />

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
        <Kpi label="库存品类" value={stock.length} unit="项" foot="在库物料" />
        <Kpi label="本月出库" value={moves.filter((m) => m.direction === "out").length}
             unit="单" foot="全部关联项目" tone="o" />
        <Kpi label="库存预警" value={alerts.length} unit="项" foot="低于安全库存" tone="w" />
        <Kpi label="待处理" value={pendingOut.length} unit="单" foot="待审批/部分到货" tone="b" />
      </div>

      <div className="notice" style={{ marginTop: 14 }}>
        <div>
          <b>与项目强绑定</b>
          每张出入库单必须填写来源（采购合同/项目/工单）与去向，设备类物料记录 SN 序列号，
          售后查保修与备件更换直接复用这条台账。入库必须对应采购合同到货，无采购来源的入库需单独审批。
        </div>
      </div>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1.3fr 1fr", marginTop: 14 }}
           className="max-lg:!grid-cols-1">
        <div className="card">
          <div className="card-h"><h3>出入库流水</h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>{moves.length} 条</span></div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr><th>单号</th><th>物料</th><th>数量</th><th>类型</th><th>来源/去向</th><th>日期</th><th>状态</th><th>操作</th></tr>
              </thead>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.id}>
                    <td className="num">{m.code}</td>
                    <td style={{ whiteSpace: "normal", minWidth: 160 }}>
                      {m.item_name}
                      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{m.sku}</div>
                    </td>
                    <td className="num">{m.qty}</td>
                    <td><Badge tone={m.direction === "in" ? "ok" : "pri"}>
                      {m.direction === "in" ? "入库" : "出库"}
                    </Badge></td>
                    <td style={{ whiteSpace: "normal", maxWidth: 180, fontSize: 12 }}>
                      {m.target_text ?? m.source_text ?? "—"}
                      {m.project_code && (
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{m.project_code}</div>
                      )}
                    </td>
                    <td className="num">{m.move_date ?? "—"}</td>
                    <td><Badge tone={m.status === "已入库" || m.status === "已出库" ? "ok" : "warn"}>
                      {m.status}
                    </Badge></td>
                    <td>
                      <RowActions
                        id={m.id}
                        label="出入库单"
                        apiPath="/api/stock"
                        deleteHint="删除后库存会自动回滚（入库单删除扣回，出库单删除加回）。若物料已被领用导致库存为负，将拒绝删除。"
                        editFields={[
                          { key: "moveDate", label: "日期", type: "date", defaultValue: m.move_date ?? "" },
                          { key: "remark", label: "备注", colSpan: 2 },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-h"><h3>实时库存</h3>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>含安全库存校验</span></div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr><th>物料</th><th>仓库</th><th>库存</th><th>安全</th><th>状态</th></tr>
              </thead>
              <tbody>
                {stock.map((s) => {
                  const low = s.qty <= (s.safe_stock ?? 0);
                  return (
                    <tr key={`${s.item_id}-${s.warehouse_id}`}
                        style={low ? { background: "var(--bad-weak)" } : undefined}>
                      <td style={{ whiteSpace: "normal", minWidth: 140 }}>
                        {s.item_name}
                        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{s.sku}</div>
                      </td>
                      <td style={{ fontSize: 12 }}>{s.warehouse_name}</td>
                      <td className="num" style={{ color: low ? "var(--bad)" : undefined }}>
                        {s.qty} {s.unit}
                      </td>
                      <td className="num">{s.safe_stock}</td>
                      <td><Badge tone={low ? "bad" : "ok"}>{low ? "库存不足" : "正常"}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
