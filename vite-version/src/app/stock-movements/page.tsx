import * as React from "react"
import { ClipboardList, Plus, RefreshCw, TrendingDown, TrendingUp } from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { useProducts } from "@/hooks/use-products"
import { api } from "@/lib/api-client"
import { formatDate } from "@/lib/format"

type Warehouse={id:string;name:string;code:string;is_active:boolean}
type Movement={id:string;movement_type:string;quantity:string|number;unit_cost:string|number;reference:string|null;notes:string|null;created_at:string;product_name:string;sku:string;warehouse_name:string}
type Mode="receipt"|"issue"|"transfer"|"adjustment"
const initial={productId:"",warehouseId:"",sourceWarehouseId:"",destinationWarehouseId:"",quantity:"1",unitCost:"0",newQuantity:"0",reference:"",notes:""}
export default function StockMovementsPage(){
  const {products}=useProducts()
  const [warehouses,setWarehouses]=React.useState<Warehouse[]>([])
  const [movements,setMovements]=React.useState<Movement[]>([])
  const [loading,setLoading]=React.useState(true)
  const [saving,setSaving]=React.useState(false)
  const [error,setError]=React.useState<string|null>(null)
  const [mode,setMode]=React.useState<Mode>("receipt")
  const [showForm,setShowForm]=React.useState(false)
  const [form,setForm]=React.useState(initial)
  const load=React.useCallback(async()=>{
    setLoading(true);setError(null)
    try{const [w,m]=await Promise.all([api.get<Warehouse[]>("/inventory/warehouses"),api.get<Movement[]>("/inventory/movements?limit=150")]);setWarehouses(w.filter(x=>x.is_active));setMovements(m)}
    catch(e){setError((e as {message?:string}).message??"Could not load stock ledger.")}
    finally{setLoading(false)}
  },[])
  React.useEffect(()=>{void Promise.resolve().then(load)},[load])
  const stockProducts=products.filter(p=>p.is_active&&!p.is_service)
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();setSaving(true);setError(null)
    const base={productId:form.productId,unitCost:Number(form.unitCost||0),reference:form.reference.trim()||undefined,notes:form.notes.trim()||undefined}
    try{
      if(mode==="receipt"||mode==="issue") await api.post("/inventory/"+(mode==="receipt"?"receipts":"issues"),{...base,warehouseId:form.warehouseId,quantity:Number(form.quantity)})
      else if(mode==="adjustment") await api.post("/inventory/adjustments",{...base,warehouseId:form.warehouseId,newQuantity:Number(form.newQuantity)})
      else await api.post("/inventory/transfers",{...base,sourceWarehouseId:form.sourceWarehouseId,destinationWarehouseId:form.destinationWarehouseId,quantity:Number(form.quantity)})
      setForm(initial);setShowForm(false);await load()
    }catch(e){setError((e as {message?:string}).message??"Could not post stock movement.")}
    finally{setSaving(false)}
  }
  const inbound=movements.filter(m=>["receipt","transfer_in","opening_balance"].includes(m.movement_type)).length
  const outbound=movements.filter(m=>["issue","transfer_out"].includes(m.movement_type)).length
  return <BaseLayout><div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
    <PageHeader title="Stock Movements" description="Auditable stock receipts, issues, adjustments and warehouse transfers" action={<div className="flex gap-2"><Button variant="outline" onClick={()=>void load()} disabled={loading}><RefreshCw className="mr-2 size-4"/>Refresh</Button><Button onClick={()=>setShowForm(v=>!v)}><Plus className="mr-2 size-4"/>Record movement</Button></div>}/>
    {error&&<div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
    <section className="grid gap-4 sm:grid-cols-3"><Card><CardContent className="flex items-center gap-3 pt-4"><ClipboardList className="size-5 text-muted-foreground"/><div><p className="text-sm text-muted-foreground">Ledger entries loaded</p><p className="text-2xl font-semibold">{movements.length}</p></div></CardContent></Card><Card><CardContent className="flex items-center gap-3 pt-4"><TrendingUp className="size-5 text-emerald-600"/><div><p className="text-sm text-muted-foreground">Inbound entries</p><p className="text-2xl font-semibold">{inbound}</p></div></CardContent></Card><Card><CardContent className="flex items-center gap-3 pt-4"><TrendingDown className="size-5 text-muted-foreground"/><div><p className="text-sm text-muted-foreground">Outbound entries</p><p className="text-2xl font-semibold">{outbound}</p></div></CardContent></Card></section>
    {showForm&&<Card><CardContent className="pt-5"><form onSubmit={submit} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <label className="grid gap-1.5 text-sm">Movement type<select className="h-9 rounded-md border bg-background px-3" value={mode} onChange={e=>setMode(e.target.value as Mode)}><option value="receipt">Stock receipt / stock in</option><option value="issue">Stock issue / stock out</option><option value="transfer">Transfer between warehouses</option><option value="adjustment">Physical count adjustment</option></select></label>
      <label className="grid gap-1.5 text-sm">Product<select required className="h-9 rounded-md border bg-background px-3" value={form.productId} onChange={e=>setForm({...form,productId:e.target.value})}><option value="">Select product…</option>{stockProducts.map(p=><option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}</select></label>
      {mode==="transfer"?<><label className="grid gap-1.5 text-sm">From warehouse<select required className="h-9 rounded-md border bg-background px-3" value={form.sourceWarehouseId} onChange={e=>setForm({...form,sourceWarehouseId:e.target.value})}><option value="">Select source…</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}</select></label><label className="grid gap-1.5 text-sm">To warehouse<select required className="h-9 rounded-md border bg-background px-3" value={form.destinationWarehouseId} onChange={e=>setForm({...form,destinationWarehouseId:e.target.value})}><option value="">Select destination…</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}</select></label></>:<label className="grid gap-1.5 text-sm">Warehouse<select required className="h-9 rounded-md border bg-background px-3" value={form.warehouseId} onChange={e=>setForm({...form,warehouseId:e.target.value})}><option value="">Select warehouse…</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}</select></label>}
      {mode==="adjustment"?<label className="grid gap-1.5 text-sm">Counted quantity<Input required type="number" min="0" step="0.0001" value={form.newQuantity} onChange={e=>setForm({...form,newQuantity:e.target.value})}/></label>:<label className="grid gap-1.5 text-sm">Quantity<Input required type="number" min="0.0001" step="0.0001" value={form.quantity} onChange={e=>setForm({...form,quantity:e.target.value})}/></label>}
      <label className="grid gap-1.5 text-sm">Unit cost (KES)<Input type="number" min="0" step="0.0001" value={form.unitCost} onChange={e=>setForm({...form,unitCost:e.target.value})}/></label>
      <label className="grid gap-1.5 text-sm">Reference (PO, delivery note, etc.)<Input value={form.reference} onChange={e=>setForm({...form,reference:e.target.value})} placeholder="GRN-2026-001"/></label>
      <label className="grid gap-1.5 text-sm md:col-span-2 xl:col-span-3">Notes<textarea className="min-h-20 rounded-md border bg-background px-3 py-2" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="Reason for the movement or count variance"/></label>
      <div className="flex gap-2 md:col-span-2 xl:col-span-3"><Button type="submit" disabled={saving||!stockProducts.length||!warehouses.length}>{saving?"Posting…":"Post movement"}</Button><Button type="button" variant="outline" onClick={()=>setShowForm(false)}>Cancel</Button></div>
    </form></CardContent></Card>}
    <Card><CardContent className="pt-4">{loading?<div className="flex justify-center py-12"><LoadingSpinner/></div>:movements.length===0?<div className="py-12 text-center text-sm text-muted-foreground">No stock transactions yet. Record a receipt to establish opening operational stock.</div>:<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="px-3 py-3 font-medium">Date</th><th className="px-3 py-3 font-medium">Product</th><th className="px-3 py-3 font-medium">Warehouse</th><th className="px-3 py-3 font-medium">Movement</th><th className="px-3 py-3 text-right font-medium">Quantity</th><th className="px-3 py-3 font-medium">Reference / notes</th></tr></thead><tbody>{movements.map(m=><tr key={m.id} className="border-b last:border-0"><td className="whitespace-nowrap px-3 py-3">{formatDate(m.created_at)}</td><td className="px-3 py-3"><div className="font-medium">{m.product_name}</div><div className="text-xs text-muted-foreground">{m.sku}</div></td><td className="px-3 py-3">{m.warehouse_name}</td><td className="px-3 py-3 capitalize">{m.movement_type.replaceAll("_"," ")}</td><td className={Number(m.quantity)<0?"px-3 py-3 text-right font-medium tabular-nums text-destructive":"px-3 py-3 text-right font-medium tabular-nums"}>{Number(m.quantity)>0?"+":""}{Number(m.quantity).toLocaleString("en-KE",{maximumFractionDigits:4})}</td><td className="max-w-64 px-3 py-3"><div>{m.reference||"—"}</div>{m.notes&&<div className="truncate text-xs text-muted-foreground">{m.notes}</div>}</td></tr>)}</tbody></table></div>}</CardContent></Card>
  </div></BaseLayout>
}
