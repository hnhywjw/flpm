/**
 * 回款 / 开票 双维度状态标签
 * 回款状态：已付款 / 部分付款 / 未付款
 * 开票状态：已开票 / 部分开票 / 未开票
 */
export function PaymentStatusBadge({
  planCents, actualCents,
}: { planCents: number; actualCents: number }) {
  const pct = planCents > 0 ? actualCents / planCents : 0;
  if (actualCents <= 0) {
    return <span className="badge b-gray">未付款</span>;
  }
  if (pct >= 0.999) {
    return <span className="badge b-ok">已付款</span>;
  }
  return <span className="badge b-warn">部分付款 {(pct * 100).toFixed(0)}%</span>;
}

export function InvoiceStatusBadge({
  planCents, invoicedCents,
}: { planCents: number; invoicedCents: number }) {
  const pct = planCents > 0 ? invoicedCents / planCents : 0;
  if (invoicedCents <= 0) {
    return <span className="badge b-gray">未开票</span>;
  }
  if (pct >= 0.999) {
    return <span className="badge b-pri">已开票</span>;
  }
  return <span className="badge b-vio">部分开票 {(pct * 100).toFixed(0)}%</span>;
}
