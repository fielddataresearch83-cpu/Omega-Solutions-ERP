import * as React from "react"
import { AlertCircle, Boxes, Package, RefreshCw, Warehouse as WarehouseIcon } from "lucide-react"
import { BaseLayout } from "@/components/layouts/base-layout"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { api } from "@/lib/api-client"
import { formatKES, formatNumber } from "@/lib/format"

type StockRow={id:string;product_id:string;warehouse_id:string;quantity:string|number;reserved_quantity:string|number;reorder_level:string|number;available_quantity:string|number;status:string;warehouse_name:string;warehouse_code:string;sku:string;product_name:string;unit:string;cost_price:string|number;average_unit_cost:string|number}
type Summary={stocked_products:number|string;low_stock_lines:number|string;out_of_stock_lines:number|string;inventory_cost_value:number|string;active_warehouses:number|string;movements_last_30_days:number|string}
type Warehouse={id:string;code:string;name:string}
export default function StockLevelsPage(){
  const [rows,setRows]=React.useState<StockRow[]>([])
  const [summary,setSummary]=React.useState<Summary|null>(null)
  const [warehouses,setWarehouses]=React.useState<Warehouse[]>([])
  const [search,setSearch]=React.useState("")
  const [warehouseId,setWarehouseId]=React.useState("all")
  const [statusFilter,setStatusFilter]=React.useState("all")
  const [loading,setLoading]=React.useState(true)
  const [error,setError]=React.useState<string|null>(null)
  const load=React.useCallback(async()=>{
    setLoading(true);setError(null)
    try{
      const [stock,snapshot,locations]=await Promise.all([
        api.get<StockRow[]>("/inventory/stock"),
        api.get<Summary>("/inventory/summary"),
        api.get<Warehouse[]>("/inventory/warehouses"),
      ])
      setRows(stock);setSummary(snapshot);setWarehouses(locations)
    }catch(e){setError((e as {message?:string}).message??"Could not load inventory balances.")}
    finally{setLoading(false)}
  },[])
  React.useEffect(()=>{let active=true;void Promise.all([api.get<StockRow[]>("/inventory/stock"),api.get<Summary>("/inventory/summary"),api.get<Warehouse[]>("/inventory/warehouses")]).then(([stock,snapshot,locations])=>{if(active){setRows(stock);setSummary(snapshot);setWarehouses(locations);}}).catch(e=>{if(active)setError((e as {message?:string}).message??"Could not load inventory balances.");}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[])
  const filtered=rows.filter(r=>{
    const q=search.toLowerCase()
    const matches=!q||r.product_name.toLowerCase().includes(q)||r.sku.toLowerCase().includes(q)||r.warehouse_name.toLowerCase().includes(q)
    return matches&&(warehouseId==="all"||r.warehouse_id===warehouseId)&&(statusFilter==="all"||r.status===statusFilter)
  })
  const low=rows.filter(r=>r.status==="low_stock"&&Number(r.quantity)>0).length
  const out=rows.filter(r=>r.status==="out_of_stock").length
  const totalCost=Number(summary?.inventory_cost_value||0)
  return <BaseLayout><div className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
    <PageHeader title="Stock Levels" description="Live, per-warehouse stock balances with available quantity and reorder alerts" action={<Button variant="outline" onClick={()=>void load()} disabled={loading}><RefreshCw className="mr-2 size-4"/>Refresh</Button>}/>
    {error&&<div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card><CardContent className="flex items-center justify-between gap-4 pt-4"><div><p className="text-sm text-muted-foreground">Stocked products</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(Number(summary?.stocked_products||0))}</p></div><Package className="size-5 text-muted-foreground"/></CardContent></Card>
      <Card><CardContent className="flex items-center justify-between gap-4 pt-4"><div><p className="text-sm text-muted-foreground">Low stock lines</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(low)}</p></div><AlertCircle className="size-5 text-amber-600"/></CardContent></Card>
      <Card><CardContent className="flex items-center justify-between gap-4 pt-4"><div><p className="text-sm text-muted-foreground">Out of stock</p><p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(out)}</p></div><Boxes className="size-5 text-muted-foreground"/></CardContent></Card>
      <Card><CardContent className="flex items-center justify-between gap-4 pt-4"><div><p className="text-sm text-muted-foreground">Recorded cost value</p><p className="mt-1 break-words text-2xl font-semibold tabular-nums">{formatKES(totalCost)}</p></div><WarehouseIcon className="size-5 text-muted-foreground"/></CardContent></Card>
    </section>
    <Card><CardContent className="space-y-4 pt-4">
      <div className="grid gap-3 md:grid-cols-[1fr_220px_180px]">
        <Input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search product, SKU, or warehouse…" aria-label="Search inventory"/>
        <select aria-label="Filter warehouse" className="h-9 rounded-md border bg-background px-3 text-sm" value={warehouseId} onChange={e=>setWarehouseId(e.target.value)}><option value="all">All warehouses</option>{warehouses.map(w=><option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}</select>
        <select aria-label="Filter stock status" className="h-9 rounded-md border bg-background px-3 text-sm" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">All stock statuses</option><option value="in_stock">In stock</option><option value="low_stock">Low stock</option><option value="out_of_stock">Out of stock</option></select>
      </div>
      {loading?<div className="flex justify-center py-12"><LoadingSpinner/></div>:filtered.length===0?<div className="py-12 text-center text-sm text-muted-foreground">{rows.length?"No stock balances match these filters.":"No stock balances yet. Add products and record a stock receipt to begin."}</div>:<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground"><th className="px-3 py-3 font-medium">Product</th><th className="px-3 py-3 font-medium">Warehouse</th><th className="px-3 py-3 text-right font-medium">On hand</th><th className="px-3 py-3 text-right font-medium">Reserved</th><th className="px-3 py-3 text-right font-medium">Available</th><th className="px-3 py-3 text-right font-medium">Reorder at</th><th className="px-3 py-3 text-right font-medium">Stock value</th><th className="px-3 py-3 font-medium">Status</th></tr></thead><tbody>{filtered.map(r=><tr key={r.id} className="border-b last:border-0"><td className="px-3 py-3"><div className="font-medium">{r.product_name}</div><div className="text-xs text-muted-foreground">{r.sku}</div></td><td className="px-3 py-3"><div>{r.warehouse_name}</div><div className="text-xs text-muted-foreground">{r.warehouse_code}</div></td><td className="px-3 py-3 text-right tabular-nums">{formatNumber(Number(r.quantity))} {r.unit}</td><td className="px-3 py-3 text-right tabular-nums">{formatNumber(Number(r.reserved_quantity))}</td><td className="px-3 py-3 text-right font-medium tabular-nums">{formatNumber(Number(r.available_quantity))}</td><td className="px-3 py-3 text-right tabular-nums">{formatNumber(Number(r.reorder_level))}</td><td className="px-3 py-3 text-right tabular-nums">{formatKES(Number(r.quantity)*Number(r.average_unit_cost))}</td><td className="px-3 py-3"><span className={r.status==="in_stock"?"rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-700 dark:text-emerald-300":r.status==="low_stock"?"rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-300":"rounded-full bg-destructive/10 px-2 py-1 text-xs text-destructive"}>{r.status.replaceAll("_"," ")}</span></td></tr>)}</tbody></table></div>}
    </CardContent></Card>
  </div></BaseLayout>
}
