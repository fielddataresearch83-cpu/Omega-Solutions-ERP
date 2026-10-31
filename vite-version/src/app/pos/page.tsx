import * as React from "react"
import { Banknote, Clock3, Download, Plus, RefreshCw, Trash2, Store, ReceiptText, Package } from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { api } from "@/lib/api-client"
import { formatKES } from "@/lib/format"
import { useMyCompany } from "@/hooks/use-company"
import { useAuth } from "@/contexts/auth-context"

type Register = { id:string; code:string; name:string; branch_name:string|null; is_active:boolean; open_shift_id:string|null }
type Shift = { id:string; register_id:string; register_code:string; register_name:string; opening_float:string|number; opened_at:string; status:"open"|"closed" }
type Warehouse = { id:string; code:string; name:string; is_active:boolean }
type Customer = { id:string; name:string; phone?:string|null; is_active:boolean }
type Product = { id:string; sku:string; name:string; unit:string; selling_price:string|number; cost_price:string|number; is_service:boolean; image_url?:string|null; available_quantity:string|number }
type CartLine = { product:Product; quantity:number; unitPrice:number; taxRate:number }
type PaymentLine = { method:"cash"|"mpesa"|"bank"|"card"|"cheque"; amount:string; reference:string }
type LastSale = {saleNumber:string;total:number;status:string;items:{name:string;sku:string;quantity:number;unitPrice:number;taxRate:number}[];payments:{method:string;amount:string;reference:string}[];customerName:string};
function receiptEscape(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function downloadReceipt(sale: LastSale, companyName: string) {
  const lines = sale.items.map(item => `<tr><td>${receiptEscape(item.name)}<small>${receiptEscape(item.sku)}</small></td><td>${item.quantity}</td><td>${receiptEscape(formatKES(item.unitPrice))}</td><td>${receiptEscape(formatKES(item.quantity*item.unitPrice*(1+item.taxRate/100)))}</td></tr>`).join("");
  const payments = sale.payments.map(payment => `<tr><td>${receiptEscape(payment.method.toUpperCase())}</td><td>${receiptEscape(payment.reference || "—")}</td><td>${receiptEscape(formatKES(Number(payment.amount)))}</td><td>${payment.method === "cash" || sale.status === "completed" ? "Confirmed" : "Pending verification"}</td></tr>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${receiptEscape(sale.saleNumber)}</title><style>body{font:14px Arial,sans-serif;color:#222;max-width:760px;margin:30px auto;padding:20px}header{border-bottom:3px solid #27613a;padding-bottom:14px}h1{margin:0;color:#27613a}small{display:block;color:#666;margin-top:3px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{padding:10px 8px;border-bottom:1px solid #ddd;text-align:left}th{background:#f2f5f2;font-size:11px;text-transform:uppercase}.num{text-align:right}.total{font-size:20px;font-weight:bold;text-align:right;margin-top:20px}.note{text-align:center;color:#666;margin-top:35px}@media print{@page{size:A4;margin:15mm}body{margin:0;max-width:none}}</style></head><body><header><h1>${receiptEscape(companyName)}</h1><p>Sales receipt · ${receiptEscape(sale.saleNumber)}</p><p>Customer: ${receiptEscape(sale.customerName)}<br>Date: ${receiptEscape(new Date().toLocaleString())}<br>Payment status: ${receiptEscape(sale.status)}</p></header><h3>Items</h3><table><thead><tr><th>Product / service</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${lines}</tbody></table><div class="total">Total: ${receiptEscape(formatKES(sale.total))}</div><h3>Payments</h3><table><thead><tr><th>Method</th><th>Reference</th><th>Amount</th><th>Status</th></tr></thead><tbody>${payments}</tbody></table><p class="note">Thank you for shopping with us.</p></body></html>`;
  const url = URL.createObjectURL(new Blob([html], {type:"text/html;charset=utf-8"}));
  const link = document.createElement("a"); link.href = url; link.download = `receipt-${sale.saleNumber.replace(/[^a-zA-Z0-9_-]/g,"-")}.html`;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}

export default function PosPage() {
  const { company } = useMyCompany();
  const { user } = useAuth();
  const canViewTeam = Boolean(user?.permissions.includes("sales:team-read"));
  const [registers,setRegisters]=React.useState<Register[]>([])
  const [shift,setShift]=React.useState<Shift|null>(null)
  const [warehouses,setWarehouses]=React.useState<Warehouse[]>([])
  const [customers,setCustomers]=React.useState<Customer[]>([])
  const [products,setProducts]=React.useState<Product[]>([])
  const [productsRevision,setProductsRevision]=React.useState(0)
  const [sales,setSales]=React.useState<Record<string,unknown>[]>([])
  const [loading,setLoading]=React.useState(true)
  const [saving,setSaving]=React.useState(false)
  const [error,setError]=React.useState<string|null>(null)
  const [notice,setNotice]=React.useState<string|null>(null)
  const [showRegisterForm,setShowRegisterForm]=React.useState(false)
  const [registerForm,setRegisterForm]=React.useState({code:"",name:""})
  const [registerId,setRegisterId]=React.useState("")
  const [openingFloat,setOpeningFloat]=React.useState("0")
  const [countedCash,setCountedCash]=React.useState("")
  const [closeNotes,setCloseNotes]=React.useState("")
  const [warehouseId,setWarehouseId]=React.useState("")
  const [customerId,setCustomerId]=React.useState("")
  const [search,setSearch]=React.useState("")
  const [cart,setCart]=React.useState<CartLine[]>([])
  const [payments,setPayments]=React.useState<PaymentLine[]>([{method:"cash",amount:"",reference:""}])
  const [lastSale,setLastSale]=React.useState<LastSale|null>(null)
  const [requestId,setRequestId]=React.useState(()=>crypto.randomUUID())

  const load=React.useCallback(async()=>{
    setLoading(true);setError(null)
    try{
      const [regs,current,warehouseRows,customerRows,saleRows,assignment]=await Promise.all([
        api.get<Register[]>("/pos/registers"),api.get<Shift|null>("/pos/shifts/current"),
        canViewTeam ? api.get<Warehouse[]>("/inventory/warehouses") : Promise.resolve([] as Warehouse[]),api.get<Customer[]>("/customers"),
        api.get<Record<string,unknown>[]>("/pos/sales?limit=10"),api.get<{warehouse_id:string;warehouse_code:string;warehouse_name:string}|null>("/pos/salesperson-assignment/me")
      ])
      const activeWarehouses = canViewTeam
        ? warehouseRows.filter(w=>w.is_active)
        : assignment ? [{id:assignment.warehouse_id,code:assignment.warehouse_code,name:assignment.warehouse_name,is_active:true}] : []
      setRegisters(regs);setShift(current);setWarehouses(activeWarehouses);setCustomers(customerRows.filter(c=>c.is_active));setSales(saleRows)
      setRegisterId(current?.register_id??regs.find(r=>r.is_active&&!r.open_shift_id)?.id??"")
      setWarehouseId(assignment?.warehouse_id ?? activeWarehouses[0]?.id ?? "")
    }catch(e){setError((e as {message?:string}).message??"Could not load POS data.")}
    finally{setLoading(false)}
  },[canViewTeam])
  React.useEffect(()=>{void Promise.resolve().then(load)},[load])
  React.useEffect(()=>{
    let active=true
    const url="/pos/products?"+(warehouseId?"warehouseId="+encodeURIComponent(warehouseId)+"&":"")+"search="+encodeURIComponent(search)
    api.get<Product[]>(url).then(rows=>{if(active)setProducts(rows)}).catch(e=>{if(active)setError((e as {message?:string}).message??"Could not load products.")})
    return()=>{active=false}
  },[search,warehouseId,productsRevision])

  const subtotal=cart.reduce((sum,line)=>sum+Math.round(line.quantity*line.unitPrice*100)/100,0)
  const tax=cart.reduce((sum,line)=>sum+Math.round(Math.round(line.quantity*line.unitPrice*100)*line.taxRate/100)/100,0)
  const total=Math.round((subtotal+tax)*100)/100
  const paidEntered=payments.reduce((sum,p)=>sum+(p.amount===""?0:Number(p.amount)||0),0)
  const paymentTotal=payments.length===1&&payments[0].amount===""?total:Math.round(paidEntered*100)/100

  function addProduct(product:Product){
    const available=Number(product.available_quantity)
    const existing=cart.find(line=>line.product.id===product.id)
    if(!product.is_service&&(!Number.isFinite(available)||available-(existing?.quantity??0)<1)){
      setError("There is not enough available stock to add another unit of "+product.name+".")
      return
    }
    setError(null)
    setCart(old=>{
      const current=old.find(line=>line.product.id===product.id)
      if(current)return old.map(line=>line.product.id===product.id?{...line,quantity:current.quantity+1}:line)
      return [...old,{product,quantity:1,unitPrice:Number(product.selling_price),taxRate:0}]
    })
  }
  function updateLine(id:string,patch:Partial<Pick<CartLine,"quantity"|"unitPrice"|"taxRate">>){
    const current=cart.find(line=>line.product.id===id)
    if(!current)return
    const next={...current,...patch}
    if(!Number.isFinite(next.quantity)||next.quantity<=0||Math.round(next.quantity*1000)!==next.quantity*1000){
      setError("Quantity must be positive and use no more than three decimal places.")
      return
    }
    if(!current.product.is_service&&next.quantity>Number(current.product.available_quantity)){
      setError("Quantity exceeds available stock for "+current.product.name+".")
      return
    }
    if(!Number.isFinite(next.unitPrice)||next.unitPrice<0||Math.round(next.unitPrice*100)!==next.unitPrice*100){
      setError("Unit price must be non-negative and limited to two decimal places.")
      return
    }
    if(!Number.isFinite(next.taxRate)||next.taxRate<0||next.taxRate>100||Math.round(next.taxRate*100)!==next.taxRate*100){
      setError("Tax rate must be between 0 and 100 with up to two decimal places.")
      return
    }
    setError(null)
    setCart(old=>old.map(line=>line.product.id===id?next:line))
  }
  async function createRegister(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();setSaving(true);setError(null)
    try{await api.post("/pos/registers",{code:registerForm.code.trim(),name:registerForm.name.trim()});setRegisterForm({code:"",name:""});setShowRegisterForm(false);await load()}
    catch(e){setError((e as {message?:string}).message??"Could not create register.")}
    finally{setSaving(false)}
  }
  async function openShift(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();setSaving(true);setError(null)
    try{await api.post("/pos/shifts/open",{registerId,openingFloat:Number(openingFloat)});await load()}
    catch(e){setError((e as {message?:string}).message??"Could not open cashier shift.")}
    finally{setSaving(false)}
  }
  async function closeShift(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(!shift)return
    setSaving(true);setError(null)
    try{const result=await api.post<{cash_difference:number|string}>("/pos/shifts/"+shift.id+"/close",{countedCash:Number(countedCash),notes:closeNotes.trim()||undefined});setNotice("Shift closed. Cash variance: "+formatKES(Number(result.cash_difference)));setCountedCash("");setCloseNotes("");await load()}
    catch(e){setError((e as {message?:string}).message??"Could not close cashier shift.")}
    finally{setSaving(false)}
  }
  async function checkout(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault()
    if(!shift){setError("Open a cashier shift before checkout.");return}
    if(!warehouseId){setError("Choose a warehouse.");return}
    if(!cart.length){setError("Add at least one product to the cart.");return}
    const normalized=payments.map(p=>({...p,amount:p.amount===""&&payments.length===1?String(total):p.amount}))
    if(normalized.some(p=>!p.amount||!Number.isFinite(Number(p.amount))||Number(p.amount)<=0)){setError("Enter a valid amount for every payment line.");return}
    if(Math.round(normalized.reduce((sum,p)=>sum+Number(p.amount),0)*100)!==Math.round(total*100)){setError("Payment amounts must equal the exact checkout total.");return}
    if(normalized.some(p=>p.method==="mpesa"&&!p.reference.trim())){setError("Enter the M-Pesa transaction reference. It will remain pending verification.");return}
    setSaving(true);setError(null);setNotice(null)
    try{
      const result=await api.post<{saleNumber:string;total:number;status:string}>("/pos/checkout",{
        requestId,shiftId:shift.id,warehouseId,customerId:customerId||undefined,
        items:cart.map(line=>({productId:line.product.id,quantity:line.quantity,unitPrice:line.unitPrice,taxRate:line.taxRate})),
        payments:normalized.map(p=>({method:p.method,amount:Number(p.amount),reference:p.reference.trim()||undefined}))
      })
      setLastSale({...result,items:cart.map(line=>({name:line.product.name,sku:line.product.sku,quantity:line.quantity,unitPrice:line.unitPrice,taxRate:line.taxRate})),payments:normalized.map(p=>({method:p.method,amount:p.amount,reference:p.reference})),customerName:customers.find(c=>c.id===customerId)?.name??"Walk-in Customer"});setNotice("Sale "+result.saleNumber+" recorded successfully.");setRequestId(crypto.randomUUID());setCart([]);setPayments([{method:"cash",amount:"",reference:""}]);setProductsRevision(v=>v+1);await load()
    }catch(e){setError((e as {message?:string}).message??"Checkout failed. No sale should be recorded if validation failed.")}
    finally{setSaving(false)}
  }

  return <BaseLayout><style>{`@media print { body.pos-print-receipt #root * { visibility: hidden !important; } body.pos-print-receipt #pos-receipt, body.pos-print-receipt #pos-receipt * { visibility: visible !important; } body.pos-print-receipt #pos-receipt { position: absolute; left: 0; top: 0; width: 80mm; margin: 0; border: 0; box-shadow: none; } }`}</style><div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
    <PageHeader title="Point of Sale" description="Live product checkout, shift control and cash-up" action={<div className="flex gap-2"><Button variant="outline" onClick={()=>void load()} disabled={loading||saving}><RefreshCw className="mr-2 size-4"/>Refresh</Button><Button variant="outline" onClick={()=>setShowRegisterForm(v=>!v)}><Plus className="mr-2 size-4"/>Register</Button></div>}/>
    {error&&<div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
    {notice&&<div role="status" className="rounded-md border border-emerald-600/30 bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">{notice}</div>}
    {lastSale&&<Card id="pos-receipt"><CardContent className="pt-5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><ReceiptText className="size-6"/><div><p className="font-semibold">Sale {lastSale.saleNumber}</p><p className="text-sm text-muted-foreground">{lastSale.status==="completed"?"Payment confirmed":"Payment pending verification"} · {formatKES(Number(lastSale.total))}</p></div></div><Button variant="outline" onClick={()=>downloadReceipt(lastSale, company?.name || "Omega Solutions")}><Download className="mr-1 size-4"/>Download receipt</Button><Button variant="outline" onClick={()=>{document.body.classList.add("pos-print-receipt");window.print();document.body.classList.remove("pos-print-receipt")}}>Print / Save PDF</Button></div><div className="mt-4 border-t pt-4"><p className="font-semibold">Omega Solutions · Sales receipt</p><p className="text-sm text-muted-foreground">Customer: {lastSale.customerName}</p><p className="text-sm text-muted-foreground">Date: {new Date().toLocaleString()}</p><div className="mt-3 space-y-2">{lastSale.items.map((item,i)=><div key={item.sku+"-"+i} className="flex justify-between gap-3 text-sm"><div><p>{item.name}</p><p className="text-xs text-muted-foreground">{item.sku} · {item.quantity} × {formatKES(item.unitPrice)} · Tax {item.taxRate}%</p></div><span className="whitespace-nowrap">{formatKES(item.quantity*item.unitPrice*(1+item.taxRate/100))}</span></div>)}</div><div className="mt-3 border-t pt-3 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{formatKES(lastSale.items.reduce((sum,item)=>sum+Math.round(item.quantity*item.unitPrice*100)/100,0))}</span></div><div className="flex justify-between"><span>Tax</span><span>{formatKES(lastSale.items.reduce((sum,item)=>sum+Math.round(Math.round(item.quantity*item.unitPrice*100)*item.taxRate/100)/100,0))}</span></div><div className="flex justify-between text-base font-bold"><span>Total</span><span>{formatKES(lastSale.total)}</span></div></div><div className="mt-3 border-t pt-3"><p className="mb-1 text-sm font-semibold">Payments</p>{lastSale.payments.map((p,i)=><div key={p.method+"-"+i} className="flex justify-between gap-3 text-sm"><span>{p.method.toUpperCase()}{p.reference?" · "+p.reference:""}{p.method!=="cash"?(lastSale.status==="completed"?" · confirmed":" · pending verification"):" · confirmed"}</span><span>{formatKES(Number(p.amount))}</span></div>)}</div><p className="mt-4 text-center text-xs text-muted-foreground">Thank you for shopping with us.</p></div></CardContent></Card>}
    {showRegisterForm&&<Card><CardContent className="pt-5"><form onSubmit={createRegister} className="grid gap-3 sm:grid-cols-3"><label className="grid gap-1.5 text-sm">Register code<Input required maxLength={32} value={registerForm.code} onChange={e=>setRegisterForm({...registerForm,code:e.target.value})} placeholder="TILL-01"/></label><label className="grid gap-1.5 text-sm">Register name<Input required maxLength={120} value={registerForm.name} onChange={e=>setRegisterForm({...registerForm,name:e.target.value})} placeholder="Front counter"/></label><div className="flex items-end gap-2"><Button type="submit" disabled={saving}>Save register</Button><Button type="button" variant="outline" onClick={()=>setShowRegisterForm(false)}>Cancel</Button></div></form></CardContent></Card>}
    {loading?<div className="flex justify-center py-12"><LoadingSpinner/></div>:<>
      <section className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="flex items-center gap-3 pt-5"><Store className="size-5 text-muted-foreground"/><div><p className="text-sm text-muted-foreground">Registers</p><p className="text-2xl font-semibold">{registers.length}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 pt-5"><Clock3 className="size-5 text-muted-foreground"/><div><p className="text-sm text-muted-foreground">Cashier shift</p><p className="text-2xl font-semibold">{shift?"Open":"Not open"}</p><p className="text-xs text-muted-foreground">{shift?shift.register_name:"Open a shift to start selling"}</p></div></CardContent></Card>
        <Card><CardContent className="flex items-center gap-3 pt-5"><Banknote className="size-5 text-muted-foreground"/><div><p className="text-sm text-muted-foreground">Opening float</p><p className="text-2xl font-semibold tabular-nums">{formatKES(shift?Number(shift.opening_float):0)}</p></div></CardContent></Card>
      </section>
      {!shift?<Card><CardContent className="pt-5"><h2 className="font-semibold">Open cashier shift</h2><p className="mb-4 text-sm text-muted-foreground">A cashier shift is required before checkout.</p>{registers.filter(r=>r.is_active&&!r.open_shift_id).length===0?<p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">Create a register first, or all active registers are in use.</p>:<form onSubmit={openShift} className="grid gap-3 sm:grid-cols-3"><label className="grid gap-1.5 text-sm">Register<select className="h-10 rounded-md border bg-background px-3" required value={registerId} onChange={e=>setRegisterId(e.target.value)}>{registers.filter(r=>r.is_active&&!r.open_shift_id).map(r=><option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}</select></label><label className="grid gap-1.5 text-sm">Opening float (KES)<Input required type="number" min="0" step="0.01" value={openingFloat} onChange={e=>setOpeningFloat(e.target.value)}/></label><div className="flex items-end"><Button type="submit" disabled={saving||!registerId}>{saving?"Opening…":"Open shift"}</Button></div></form>}</CardContent></Card>:<div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card><CardContent className="pt-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Product catalogue</h2><p className="text-sm text-muted-foreground">Search by product name or SKU; available quantities reflect the selected warehouse.</p></div><div className="w-full sm:w-64"><Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search or scan SKU…"/></div></div>
          <label className="mt-4 grid max-w-sm gap-1.5 text-sm">Stock warehouse<select className="h-10 rounded-md border bg-background px-3" value={warehouseId} onChange={e=>setWarehouseId(e.target.value)}>{warehouses.map(w=><option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}</select></label>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">{products.map(p=><button key={p.id} type="button" onClick={()=>addProduct(p)} className="flex min-h-24 flex-col items-start justify-between rounded-lg border p-3 text-left transition hover:bg-muted/50 disabled:opacity-50" disabled={!p.is_service&&Number(p.available_quantity)<=0}><div className="flex w-full items-center gap-3">{p.image_url?<img src={p.image_url} alt="" loading="lazy" className="size-14 shrink-0 rounded-md border object-cover"/>:<div className="flex size-14 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground"><Package className="size-5"/></div>}<div className="min-w-0"><span className="block font-medium">{p.name}</span><span className="text-xs text-muted-foreground">{p.sku} · {p.is_service?"Service":Number(p.available_quantity)+" available"}</span><span className="mt-2 block font-semibold">{formatKES(Number(p.selling_price))}<span className="font-normal text-muted-foreground"> / {p.unit}</span></span></div></div></button>)}</div>
          {products.length===0&&<p className="mt-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No matching active products in this company.</p>}
        </CardContent></Card>
        <div className="flex flex-col gap-6"><Card><CardContent className="pt-5"><div className="flex items-center justify-between"><h2 className="font-semibold">Current sale</h2><span className="text-sm text-muted-foreground">{cart.length} line(s)</span></div>
          <label className="mt-3 grid gap-1.5 text-sm">Customer (optional)<select className="h-10 rounded-md border bg-background px-3" value={customerId} onChange={e=>setCustomerId(e.target.value)}><option value="">Walk-in customer</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}{c.phone?" · "+c.phone:""}</option>)}</select></label>
          <div className="mt-4 space-y-3">{cart.map(line=><div key={line.product.id} className="rounded-lg border p-3"><div className="flex items-start justify-between gap-2"><div><p className="font-medium">{line.product.name}</p><p className="text-xs text-muted-foreground">{line.product.sku}</p></div><Button size="icon" variant="ghost" onClick={()=>setCart(old=>old.filter(x=>x.product.id!==line.product.id))} aria-label={"Remove "+line.product.name}><Trash2 className="size-4"/></Button></div><div className="mt-3 grid grid-cols-3 gap-2"><label className="grid gap-1 text-xs text-muted-foreground">Qty<Input type="number" min="0.001" step="0.001" value={line.quantity} onChange={e=>updateLine(line.product.id,{quantity:Math.max(0.001,Number(e.target.value)||0.001)})}/></label><label className="grid gap-1 text-xs text-muted-foreground">Unit price<Input type="number" min="0" step="0.01" value={line.unitPrice} onChange={e=>updateLine(line.product.id,{unitPrice:Math.max(0,Number(e.target.value)||0)})}/></label><label className="grid gap-1 text-xs text-muted-foreground">Tax %<Input type="number" min="0" max="100" step="0.01" value={line.taxRate} onChange={e=>updateLine(line.product.id,{taxRate:Math.min(100,Math.max(0,Number(e.target.value)||0))})}/></label></div><p className="mt-2 text-right text-sm font-medium">{formatKES(line.quantity*line.unitPrice*(1+line.taxRate/100))}</p></div>)}</div>
          {cart.length===0&&<p className="my-4 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Select products to start a sale.</p>}
          <div className="mt-4 space-y-2 border-t pt-4 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{formatKES(subtotal)}</span></div><div className="flex justify-between"><span>Tax</span><span>{formatKES(tax)}</span></div><div className="flex justify-between text-lg font-semibold"><span>Total</span><span>{formatKES(total)}</span></div></div>
        </CardContent></Card>
        <Card><CardContent className="pt-5"><div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Payment split</h2><Button size="sm" variant="outline" onClick={()=>setPayments(old=>[...old,{method:"cash",amount:"",reference:""}])}><Plus className="mr-1 size-4"/>Add payment</Button></div><p className="mb-3 text-sm text-muted-foreground">Cash is confirmed at checkout. M-Pesa, bank, card and cheque payments remain pending until verified.</p><form onSubmit={checkout} className="grid gap-3">{payments.map((p,i)=><div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2"><label className="grid gap-1 text-xs text-muted-foreground">Method<select className="h-10 min-w-0 rounded-md border bg-background px-2 text-sm" value={p.method} onChange={e=>setPayments(old=>old.map((x,j)=>j===i?{...x,method:e.target.value as PaymentLine["method"]}:x))}><option value="cash">Cash</option><option value="mpesa">M-Pesa</option><option value="card">Card</option><option value="bank">Bank</option><option value="cheque">Cheque</option></select></label><label className="grid gap-1 text-xs text-muted-foreground">Amount (KES)<Input required type="number" min="0.01" step="0.01" value={p.amount===""&&payments.length===1?String(total):p.amount} onChange={e=>setPayments(old=>old.map((x,j)=>j===i?{...x,amount:e.target.value}:x))}/></label><Button type="button" size="icon" variant="ghost" disabled={payments.length===1} onClick={()=>setPayments(old=>old.filter((_,j)=>j!==i))} aria-label="Remove payment"><Trash2 className="size-4"/></Button>{p.method==="mpesa"&&<label className="col-span-3 grid gap-1 text-xs text-muted-foreground">M-Pesa transaction reference<Input required value={p.reference} onChange={e=>setPayments(old=>old.map((x,j)=>j===i?{...x,reference:e.target.value}:x))} placeholder="e.g. QGH7XYZ123"/></label>}</div>)}
          <div className="flex justify-between border-t pt-3 text-sm"><span>Payment total</span><span className={Math.abs(paymentTotal-total)<0.005?"font-medium":"font-semibold text-destructive"}>{formatKES(paymentTotal)}</span></div><Button type="submit" disabled={saving||cart.length===0||!warehouseId||Math.abs(paymentTotal-total)>=0.005}>{saving?"Processing sale…":"Complete checkout"}</Button></form>
        </CardContent></Card>
        <Card><CardContent className="pt-5"><h2 className="font-semibold">Close cashier shift</h2><p className="mb-3 text-sm text-muted-foreground">Expected cash includes the opening float plus confirmed cash payments linked to this shift.</p><form onSubmit={closeShift} className="grid gap-3"><label className="grid gap-1.5 text-sm">Counted cash (KES)<Input required type="number" min="0" step="0.01" value={countedCash} onChange={e=>setCountedCash(e.target.value)} placeholder="0.00"/></label><label className="grid gap-1.5 text-sm">Closing notes<Input value={closeNotes} onChange={e=>setCloseNotes(e.target.value)} maxLength={1000} placeholder="Explain any variance"/></label><Button type="submit" variant="outline" disabled={saving||countedCash===""}>Close shift and cash-up</Button></form></CardContent></Card>
      </div></div>}
      <Card><CardContent className="pt-5"><h2 className="font-semibold">Recent POS sales</h2>{sales.length===0?<p className="mt-3 text-sm text-muted-foreground">No POS sales recorded yet.</p>:<div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Sale</th><th className="p-2">Customer</th><th className="p-2">Total</th><th className="p-2">Status</th><th className="p-2">Date</th></tr></thead><tbody>{sales.map(s=><tr key={String(s.id)} className="border-b"><td className="p-2 font-medium">{String(s.sale_number)}</td><td className="p-2">{String(s.customer_name??"—")}</td><td className="p-2">{formatKES(Number(s.total))}</td><td className="p-2">{String(s.status)}</td><td className="p-2">{new Date(String(s.created_at)).toLocaleString()}</td></tr>)}</tbody></table></div>}</CardContent></Card>
    </>}
  </div></BaseLayout>
}
