"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileUploader } from "@/components/FileUploader";
import { todayLocal } from "@/lib/time";

/**
 * 过单费支付弹窗
 * 个人收款必须上传三件套（真实文件，存 storage）
 */
export function PayFeeButton({
  agreementId, label, unpaidWan, partyType, payeeHint, onDone,
}: {
  agreementId: number;
  label: string;
  unpaidWan: number;
  partyType: "company" | "individual";
  payeeHint?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [amountWan, setAmountWan] = useState("");
  const [payDate, setPayDate] = useState(todayLocal());
  const [payMethod, setPayMethod] = useState("转账");
  const [voucherNo, setVoucherNo] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [payeeIdTail, setPayeeIdTail] = useState("");
  const [remark, setRemark] = useState("");

  // 三件套：存的是附件 id
  const [docAgreement, setDocAgreement] = useState("");
  const [docVoucher, setDocVoucher] = useState("");
  const [docConfirm, setDocConfirm] = useState("");

  const isIndividual = partyType === "individual";
  const docsReady = !isIndividual || (docAgreement && docVoucher && docConfirm);

  function reset() {
    setAmountWan(""); setVoucherNo(""); setPayeeName("");
    setPayeeIdTail(""); setRemark(""); setErr(null);
    setDocAgreement(""); setDocVoucher(""); setDocConfirm("");
    setPayDate(todayLocal());
    setPayMethod("转账");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    const amt = Number(amountWan);
    if (!amt || amt <= 0) { setErr("请输入付款金额"); return; }
    if (amt > unpaidWan + 0.001) {
      setErr(`金额超过未付 ${unpaidWan.toFixed(2)} 万元`);
      return;
    }
    if (!voucherNo.trim()) { setErr("请填写凭证编号"); return; }

    if (isIndividual) {
      if (!payeeName.trim()) { setErr("请填写收款人姓名"); return; }
      if (!docAgreement) { setErr("请上传①代中标协议"); return; }
      if (!docVoucher) { setErr("请上传②付款凭证"); return; }
      if (!docConfirm) { setErr("请上传③收款确认单"); return; }
    }

    setBusy(true);
    try {
      const res = await fetch("/api/agent/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agreementId,
          amountWan: amt,
          payDate,
          payMethod,
          voucherNo: voucherNo.trim(),
          payeeName: isIndividual ? payeeName.trim() : null,
          payeeIdTail: isIndividual ? payeeIdTail : null,
          docAgreement: docAgreement || null,
          docVoucher: docVoucher || null,
          docConfirm: docConfirm || null,
          remark: remark || null,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setErr(Array.isArray(d.errors) ? d.errors.join("；") : (d.error ?? "支付失败"));
        return;
      }
      reset();
      setOpen(false);
      router.refresh();
      onDone?.();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 10px", fontSize: 13,
    border: "1px solid var(--line)", borderRadius: 8,
    background: "var(--card)", color: "var(--text)", boxSizing: "border-box",
  };
  const lbl: React.CSSProperties = {
    display: "block", fontSize: 12, color: "var(--sub)",
    fontWeight: 600, marginBottom: 6,
  };

  return (
    <>
      <button className="btn btn-sm" onClick={() => { setOpen(true); setErr(null); }}>
        {label}
      </button>

      {open && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(16,26,48,.5)",
            zIndex: 90, display: "grid", placeItems: "center", padding: 16, overflowY: "auto",
          }}
          onClick={() => setOpen(false)}
        >
          <form
            onSubmit={submit}
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ width: "100%", maxWidth: 600, padding: 20, maxHeight: "92vh", overflowY: "auto" }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 4 }}>
              <div>
                <h3 style={{ fontSize: 15.5, fontWeight: 700 }}>
                  支付过单费{isIndividual ? "（个人收款）" : ""}
                </h3>
                <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                  未付 <b style={{ color: "var(--violet)" }}>{unpaidWan.toFixed(2)}</b> 万元
                  {isIndividual && " · 个人收款必须上传三件套凭证"}
                </p>
              </div>
            </div>

            <div style={{ display: "grid", gap: 13, gridTemplateColumns: "1fr 1fr", marginTop: 16 }}>
              <div>
                <label style={lbl}>付款金额（万元）<span style={{ color: "var(--bad)" }}> *</span></label>
                <input type="number" step="0.01" value={amountWan}
                       onChange={(e) => setAmountWan(e.target.value)}
                       placeholder={unpaidWan.toFixed(2)} style={inputStyle} />
              </div>
              <div>
                <label style={lbl}>付款日期</label>
                <input type="date" value={payDate}
                       onChange={(e) => setPayDate(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={lbl}>付款方式</label>
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} style={inputStyle}>
                  <option value="转账">银行转账</option>
                  <option value="现金">现金</option>
                </select>
              </div>
              <div>
                <label style={lbl}>凭证编号<span style={{ color: "var(--bad)" }}> *</span></label>
                <input value={voucherNo} onChange={(e) => setVoucherNo(e.target.value)}
                       placeholder="如 SK-2026-1028" style={inputStyle} />
              </div>

              {isIndividual && (
                <>
                  <div>
                    <label style={lbl}>收款人姓名<span style={{ color: "var(--bad)" }}> *</span></label>
                    <input value={payeeName} onChange={(e) => setPayeeName(e.target.value)}
                           placeholder={payeeHint} style={inputStyle} />
                  </div>
                  <div>
                    <label style={lbl}>身份证后四位</label>
                    <input value={payeeIdTail} maxLength={4}
                           onChange={(e) => setPayeeIdTail(e.target.value)}
                           placeholder="仅存后四位，保护隐私" style={inputStyle} />
                  </div>
                </>
              )}

              {isIndividual && (
                <>
                  <FileUploader
                    entityType="agent_fee_payment_draft"
                    entityId={agreementId}
                    label="① 代中标协议扫描件 *"
                    hint="与对方签署的代中标协议"
                    value={docAgreement}
                    onChange={setDocAgreement}
                  />
                  <FileUploader
                    entityType="agent_fee_payment_draft"
                    entityId={agreementId}
                    label="② 付款凭证 *"
                    hint="银行回单 / 现金签收单"
                    value={docVoucher}
                    onChange={setDocVoucher}
                  />
                  <FileUploader
                    entityType="agent_fee_payment_draft"
                    entityId={agreementId}
                    label="③ 收款确认单 *"
                    hint="对方签字确认收到款项"
                    value={docConfirm}
                    onChange={setDocConfirm}
                  />
                </>
              )}

              <div style={{ gridColumn: "1 / -1" }}>
                <label style={lbl}>备注</label>
                <textarea value={remark} onChange={(e) => setRemark(e.target.value)}
                          rows={2} style={{ ...inputStyle, resize: "vertical" }} />
              </div>
            </div>

            {isIndividual && !docsReady && (
              <div className="notice warn" style={{ marginTop: 14 }}>
                <div>
                  三件套尚未齐备：协议 {docAgreement ? "✓" : "✗"}、
                  付款凭证 {docVoucher ? "✓" : "✗"}、
                  收款确认 {docConfirm ? "✓" : "✗"}
                  <br />
                  个人收款无发票，凭证是唯一凭证，缺一不可。
                </div>
              </div>
            )}

            {err && (
              <div className="notice danger" style={{ marginTop: 14 }}>
                <div>{err}</div>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>
                取消
              </button>
              <button type="submit" className="btn btn-pri" disabled={busy || !docsReady}>
                {busy ? "提交中…" : "确认支付"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
