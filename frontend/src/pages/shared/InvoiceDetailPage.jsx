import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, PageHead, StatusBadge, TlItem } from '../../components/ui.jsx';
import Icon from '../../components/Icon.jsx';
import { invoiceApi } from '../../api/invoices.js';

const money = (v) => Number(v || 0).toLocaleString('fa-IR');
const dateFa = (v) => v ? new Date(v).toLocaleDateString('fa-IR') : '—';
const timeFa = (v) => v ? new Date(v).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : '—';
const pct = (v) => `${Number(v || 0).toLocaleString('fa-IR', { maximumFractionDigits: 2 })}٪`;

function SignaturePad({ value, onChange }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    if (!value) return;
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
    img.src = value;
  }, [value]);
  const point = (e) => {
    const c = canvasRef.current, r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height };
  };
  const start = (e) => { e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true; const p = point(e); const ctx = canvasRef.current.getContext('2d'); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = (e) => { if (!drawing.current) return; const p = point(e); const ctx = canvasRef.current.getContext('2d'); ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = '#155eef'; ctx.lineTo(p.x, p.y); ctx.stroke(); };
  const end = () => { if (!drawing.current) return; drawing.current = false; onChange(canvasRef.current.toDataURL('image/png')); };
  const clear = () => { const c = canvasRef.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); onChange(''); };
  return <div className="signature-wrap"><canvas ref={canvasRef} width="900" height="260" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} /><div className="signature-hint">امضای مشتری را با انگشت یا قلم روی صفحه رسم کنید</div><button className="btn btn-ghost btn-sm" type="button" onClick={clear}>پاک کردن امضا</button></div>;
}

function PaymentForm({ invoice, onSaved }) {
  const [method, setMethod] = useState('cash');
  const [amount, setAmount] = useState(String(invoice.balance || ''));
  const [reference, setReference] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');
  const [chequeDate, setChequeDate] = useState('');
  const [chequeBank, setChequeBank] = useState('');
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const submit = async () => {
    setSaving(true); setError('');
    try { await invoiceApi.receivePayment({ invoice: invoice.id, method, amount: Number(amount), reference, cheque_number: chequeNumber, cheque_date: chequeDate || null, cheque_bank: chequeBank }); onSaved(); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  return <Card title="ثبت دریافت وجه" sub="دریافت واقعی و ثبت رسید مالی"><div className="payment-grid"><div className="field"><label>روش پرداخت</label><select value={method} onChange={e => setMethod(e.target.value)}><option value="cash">نقدی</option><option value="card">کارت</option><option value="transfer">واریز</option><option value="cheque">چک</option></select></div><div className="field"><label>مبلغ</label><input inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} /></div>{method !== 'cheque' ? <div className="field"><label>شماره پیگیری / مرجع</label><input value={reference} onChange={e => setReference(e.target.value)} /></div> : <><div className="field"><label>شماره چک</label><input value={chequeNumber} onChange={e => setChequeNumber(e.target.value)} /></div><div className="field"><label>تاریخ چک</label><input type="date" value={chequeDate} onChange={e => setChequeDate(e.target.value)} /></div><div className="field"><label>بانک</label><input value={chequeBank} onChange={e => setChequeBank(e.target.value)} /></div></>}<button className="btn btn-primary" disabled={saving || Number(amount) <= 0} onClick={submit}>{saving ? 'در حال ثبت…' : 'ثبت دریافت و رسید'}</button></div>{error && <div className="form-error">{error}</div>}</Card>;
}

const CheckDot = ({ pending }) => (
  <span className={`inv2-tl-dot ${pending ? 'pending' : ''}`}>
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
  </span>
);
const FIcon = ({ d }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

export default function InvoiceDetailPage({ invoiceId }) {
  const [invoice, setInvoice] = useState(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [signer, setSigner] = useState(''); const [signature, setSignature] = useState(''); const [signing, setSigning] = useState(false); const [signError, setSignError] = useState('');
  const load = async () => { setLoading(true); setError(''); try { const d = await invoiceApi.get(invoiceId); setInvoice(d); setSigner(d.customer_signature_name || ''); setSignature(d.customer_signature || ''); } catch (e) { setError(e.message); } finally { setLoading(false); } };
  useEffect(() => { load(); }, [invoiceId]);
  const totalPercent = useMemo(() => (invoice?.items || []).reduce((s, i) => s + Number(i.company_discount_percent || 0) + Number(i.offer_percent || 0), 0), [invoice]);
  if (loading) return <div className="card skeleton" style={{ height: 600 }} />;
  if (error) return <Card title="خطا"><div className="form-error">{error}</div><button className="btn btn-primary mt" onClick={load}>تلاش دوباره</button></Card>;
  const sign = async () => { setSigning(true); setSignError(''); try { const d = await invoiceApi.sign(invoice.id, { signature, signer_name: signer }); setInvoice(d); } catch (e) { setSignError(e.message); } finally { setSigning(false); } };

  const items = invoice.items || [];
  const history = [...(invoice.status_history || [])];
  const lastPayment = invoice.payments && invoice.payments.length ? invoice.payments[invoice.payments.length - 1] : null;
  const taxRate = (i) => {
    const base = Number(i.qty || 0) * Number(i.unit_price || 0) - Number(i.discount_amount || 0);
    return base > 0 ? (Number(i.tax_amount || 0) / base) * 100 : 0;
  };

  return <div className="invoice-detail">
    <PageHead title={`فاکتور فروش ${invoice.number}`} sub={`${invoice.company_name || 'شرکت'} · ${invoice.branch_name || 'شعبه'} · ${dateFa(invoice.created_at)}`} actions={<><button className="btn btn-ghost btn-sm" onClick={() => window.print()}><Icon name="print" size={15} /> چاپ</button><button className="btn btn-primary btn-sm" onClick={load}><Icon name="sync" size={15} /> به‌روزرسانی</button></>} />
    <div className="invoice-layout">
      <main>
        <Card className="print-card"><div className="invoice-paper inv2">
          <div className="inv2-head">
            <div className="inv2-brand">
              <div className="inv2-logo">A</div>
              <div>
                <div className="inv2-brand-name">Abtin <span>Distribution</span></div>
                <div className="inv2-brand-fa">{invoice.company_name || 'شرکت پخش آبتین'}</div>
                <div className="inv2-brand-sub">توزیع‌کننده محصولات غذایی و بهداشتی</div>
              </div>
            </div>
            <div className="inv2-slogan">همیشه در کنار شما<br />برای آینده‌ای سالم‌تر</div>
            <div className="inv2-titlebox">
              <div className="inv2-title"><Icon name="invoice" size={18} /> فاکتور فروش</div>
              <div className="inv2-numbadge">شماره فاکتور: <b>{invoice.number}</b></div>
              <div className="inv2-meta-line">تاریخ صدور: {dateFa(invoice.created_at)} &nbsp;·&nbsp; ساعت: {timeFa(invoice.created_at)}</div>
            </div>
          </div>
          <div className="inv2-cards">
            <div className="inv2-card">
              <div className="inv2-card-title"><Icon name="customer" size={15} /> مشخصات مشتری</div>
              <div className="inv2-row"><b>نام مشتری:</b><span>{invoice.customer_name_snapshot || invoice.customer_name || '—'}</span></div>
              <div className="inv2-row"><b>کد مشتری:</b><span>{money(invoice.customer)}</span></div>
              <div className="inv2-row"><b>آدرس:</b><span>{invoice.customer_address_snapshot || '—'}</span></div>
              <div className="inv2-row"><b>تلفن:</b><span>{invoice.customer_phone || '—'}</span></div>
              <div className="inv2-row"><b>کد اقتصادی:</b><span>{invoice.customer_economic_code || '—'}</span></div>
            </div>
            <div className="inv2-card">
              <div className="inv2-card-title"><Icon name="sales" size={15} /> اطلاعات فروش</div>
              <div className="inv2-row"><b>نام فروشنده:</b><span>{invoice.seller_name || '—'}</span></div>
              <div className="inv2-row"><b>کد فروشنده:</b><span>{invoice.seller_code || '—'}</span></div>
              <div className="inv2-row"><b>موقعیت:</b><span>{invoice.branch_name || '—'}{invoice.warehouse_name ? ` · ${invoice.warehouse_name}` : ''}</span></div>
              <div className="inv2-row"><b>نوع فروش:</b><span>{invoice.order_type_label || 'حضوری'}</span></div>
            </div>
            <div className="inv2-card">
              <div className="inv2-card-title"><Icon name="check" size={15} /> وضعیت فاکتور</div>
              <div className="inv2-tl">
                {history.length === 0 && <div className="inv2-tl-item"><CheckDot pending /><div><b>ثبت فاکتور</b><small>{dateFa(invoice.created_at)} · {timeFa(invoice.created_at)}</small></div></div>}
                {history.slice(-4).map((h) => (
                  <div className="inv2-tl-item" key={h.id}><CheckDot /><div><b>{h.to_status_label}</b><small>{dateFa(h.created_at)} · {timeFa(h.created_at)}{h.changed_by ? ` · ${h.changed_by}` : ''}</small></div></div>
                ))}
                <div className="inv2-tl-item"><CheckDot pending /><div><b>تسویه کامل</b><small>{invoice.payment_status === 'paid' ? 'انجام شد' : 'در انتظار'}</small></div></div>
              </div>
            </div>
          </div>
          <div className="inv2-table-wrap"><div className="table-wrap"><table className="invoice-table inv2-table">
            <thead><tr><th>ردیف</th><th>کد کالا</th><th>نام کالا</th><th>تعداد</th><th>قیمت واحد (ریال)</th><th>قیمت کل (ریال)</th><th>مالیات (٪)</th><th>تخفیف (٪)</th><th>مبلغ نهایی (ریال)</th></tr></thead>
            <tbody>{items.map((i, idx) => (
              <tr key={i.id || idx}>
                <td>{money(idx + 1)}</td>
                <td>{i.product}</td>
                <td><b>{i.product_name}</b></td>
                <td>{money(i.qty)}</td>
                <td>{money(i.unit_price)}</td>
                <td>{money(Number(i.qty || 0) * Number(i.unit_price || 0))}</td>
                <td>{pct(taxRate(i))}</td>
                <td>{pct(Number(i.company_discount_percent || 0) + Number(i.offer_percent || 0))}</td>
                <td><b>{money(i.line_total)}</b></td>
              </tr>
            ))}</tbody>
          </table></div></div>
          <div className="inv2-bottom">
            <div className="inv2-panel">
              <div className="inv2-panel-title"><Icon name="invoice" size={14} /> جمع کل و مالیات</div>
              <div className="inv2-sum-row"><span>جمع کالاها:</span><b>{money(invoice.subtotal)}</b></div>
              <div className="inv2-sum-row"><span>تخفیف‌ها:</span><b>{money(invoice.discount_total)}</b></div>
              <div className="inv2-sum-row"><span>مالیات بر ارزش افزوده (۹٪):</span><b>{money(invoice.tax_total)}</b></div>
              <div className="inv2-sum-row inv2-sum-final"><span>مبلغ نهایی فاکتور:</span><b>{money(invoice.total)}</b></div>
            </div>
            <div className="inv2-panel">
              <div className="inv2-panel-title"><Icon name="sales" size={14} /> تخفیف‌ها و درصدها</div>
              <div className="inv2-sum-row"><span>درصد تخفیف شرکت:</span><b>{pct(items.reduce((s, i) => s + Number(i.company_discount_percent || 0), 0))}</b></div>
              <div className="inv2-sum-row"><span>درصد پورسانت/ویزیتور:</span><b>{pct(items.reduce((s, i) => s + Number(i.offer_percent || 0), 0))}</b></div>
              <div className="inv2-sum-row"><span>جمع درصدهای اقلام:</span><b>{pct(totalPercent)}</b></div>
              <div className="inv2-sum-row inv2-sum-final"><span>مانده فاکتور:</span><b>{money(invoice.balance)} ریال</b></div>
            </div>
            <div className="inv2-panel">
              <div className="inv2-panel-title"><Icon name="check" size={14} /> جزئیات پرداخت</div>
              <div className="inv2-row"><b>روش پرداخت:</b><span>{lastPayment ? lastPayment.method_label : '—'}</span></div>
              <div className="inv2-row"><b>شماره چک:</b><span>{lastPayment?.method === 'cheque' ? (lastPayment.cheque_number || '—') : '—'}</span></div>
              <div className="inv2-row"><b>تاریخ چک:</b><span>{lastPayment?.method === 'cheque' && lastPayment.cheque_date ? dateFa(lastPayment.cheque_date) : '—'}</span></div>
              <div className="inv2-row"><b>نام بانک:</b><span>{lastPayment?.method === 'cheque' ? (lastPayment.cheque_bank || '—') : '—'}</span></div>
              <div className="inv2-row"><b>وضعیت:</b><span><StatusBadge status={invoice.payment_status === 'paid' ? 'PAID' : invoice.payment_status === 'partial' ? 'PARTIALLY_PAID' : 'UNPAID'} /></span></div>
            </div>
          </div>
          <div className="inv2-terms-sign">
            <div className="inv2-terms">
              <div className="inv2-panel-title"><Icon name="invoice" size={14} /> توضیحات و شرایط</div>
              <ul>
                <li>پرداخت از طریق چک به تاریخ درج‌شده معتبر است.</li>
                <li>در صورت تأخیر در پرداخت، مشمول جریمه خواهد بود.</li>
                <li>کالا تا زمان تسویه کامل، متعلق به شرکت می‌باشد.</li>
                <li>این فاکتور در ۲ نسخه صادر و دارای اعتبار می‌باشد.</li>
              </ul>
            </div>
            <div className="inv2-signs">
              <div className="inv2-sign">امضای مشتری
                {invoice.customer_signature ? <img src={invoice.customer_signature} alt="امضای مشتری" /> : <div style={{ flex: 1 }} />}
                <div className="sg-name">{invoice.customer_signature_name || 'نام و نام خانوادگی'}</div>
              </div>
              <div className="inv2-sign">امضای فروشنده
                <div style={{ flex: 1 }} />
                <div className="sg-name">{invoice.seller_name || '—'}</div>
              </div>
              <div className="inv2-sign">مهر و امضای شرکت
                <div className="inv2-stamp-box">Abtin<br />Distribution</div>
              </div>
            </div>
          </div>
          <div className="inv2-footer">
            <span className="f-item"><FIcon d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.5 2.9.7a2 2 0 0 1 1.6 2z" /> {invoice.company_phone || '—'}</span>
            <span className="f-item"><FIcon d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm18 3-10 6L2 7" /> {invoice.company_email || '—'}</span>
            <span className="f-item"><FIcon d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /> {invoice.company_website || '—'}</span>
            <span className="inv2-thanks"><FIcon d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3.4 1-4.5 2.5C10.9 4 9.3 3 7.5 3A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z" /> با تشکر از اعتماد شما</span>
          </div>
        </div></Card>
        <Card title="امضای آنلاین مشتری" sub="امضا مستقیماً روی فاکتور ثبت می‌شود"><div className="signature-grid"><div><div className="field"><label>نام و نام خانوادگی امضاکننده</label><input value={signer} onChange={e => setSigner(e.target.value)} placeholder="نام مشتری" /></div><SignaturePad value={signature} onChange={setSignature}/>{signError && <div className="form-error">{signError}</div>}<button className="btn btn-primary mt" disabled={signing || !signature || !signer.trim()} onClick={sign}>{signing ? 'در حال ثبت…' : 'ثبت و تأیید امضای مشتری'}</button></div><div className="signature-info"><Icon name="check" size={22}/><b>ثبت امن تأیید فاکتور</b><p>امضا همراه با نام امضاکننده و زمان ثبت به همین فاکتور متصل می‌شود.</p></div></div></Card>
        <PaymentForm invoice={invoice} onSaved={load}/>
      </main>
      <aside><Card title="وضعیت فاکتور"><div className="invoice-stepper">{(invoice.status_history || []).map((h) => <TlItem key={h.id} icon="check" tint="green" title={h.to_status_label} desc={h.changed_by} time={timeFa(h.created_at)} />)}</div></Card><Card title="درصدهای اعمال‌شده"><div className="percent-summary"><div><span>جمع درصد شرکت</span><b>{pct((invoice.items || []).reduce((s, i) => s + Number(i.company_discount_percent || 0), 0))}</b></div><div><span>جمع درصد آفر / ویزیتور</span><b>{pct((invoice.items || []).reduce((s, i) => s + Number(i.offer_percent || 0), 0))}</b></div><div><span>جمع درصدها در اقلام</span><b>{pct(totalPercent)}</b></div></div></Card><Card title="پرداخت‌های ثبت‌شده">{invoice.payments?.length ? invoice.payments.map(p => <div className="payment-row" key={p.id}><div><b>{money(p.amount)} ریال</b><span>{p.method_label}</span></div><small>{p.method === 'cheque' ? `چک ${p.cheque_number || '—'} · ${p.cheque_date ? dateFa(p.cheque_date) : 'بدون تاریخ'}${p.cheque_bank ? ` · ${p.cheque_bank}` : ''}` : (p.reference || 'بدون مرجع')}</small></div>) : <div className="muted">هنوز پرداختی ثبت نشده است.</div>}</Card></aside>
    </div>
  </div>;
}
