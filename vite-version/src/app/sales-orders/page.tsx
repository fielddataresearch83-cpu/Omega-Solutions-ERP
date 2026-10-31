import * as React from "react";
import { AlertCircle, Loader2, RefreshCw, ShoppingCart, CheckCircle2, XCircle } from "lucide-react";
import { BaseLayout } from "@/components/layouts/base-layout";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { formatKES, formatDate } from "@/lib/format";

type SalesOrderStatus = "confirmed" | "processing" | "fulfilled" | "cancelled";
type Warehouse = { id: string; code: string; name: string; is_active: boolean };
type SalesOrder = { id: string; customer_name: string; source_quotation_number: string | null; order_number: string; order_date: string; status: SalesOrderStatus; total: string | number; item_count: number; notes: string | null };
const labels: Record<SalesOrderStatus, string> = { confirmed: "Confirmed", processing: "Processing", fulfilled: "Fulfilled", cancelled: "Cancelled" };
function messageOf(error: unknown) { return error && typeof error === "object" && "message" in error ? String((error as {message: unknown}).message) : "Request failed. Please try again."; }
function badge(status: SalesOrderStatus) { return status === "fulfilled" ? "bg-emerald-500/10 text-emerald-700" : status === "cancelled" ? "bg-destructive/10 text-destructive" : status === "processing" ? "bg-blue-500/10 text-blue-700" : "bg-muted text-muted-foreground"; }

export default function SalesOrdersPage() {
  const [orders, setOrders] = React.useState<SalesOrder[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [filter, setFilter] = React.useState("all");
  const [busyId, setBusyId] = React.useState("");
  const [warehouses, setWarehouses] = React.useState<Warehouse[]>([]);
  const [fulfillmentWarehouseId, setFulfillmentWarehouseId] = React.useState("");
  const refresh = React.useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [nextOrders, nextWarehouses] = await Promise.all([api.get<SalesOrder[]>("/sales-orders"), api.get<Warehouse[]>("/inventory/warehouses")]);
      setOrders(nextOrders);
      const activeWarehouses = nextWarehouses.filter((warehouse) => warehouse.is_active);
      setWarehouses(activeWarehouses);
      setFulfillmentWarehouseId((current) => activeWarehouses.some((warehouse) => warehouse.id === current) ? current : activeWarehouses[0]?.id ?? "");
    }
    catch (e) { setError(messageOf(e)); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);

  const changeStatus = async (order: SalesOrder, status: SalesOrderStatus) => {
    setBusyId(order.id); setError("");
    try {
      await api.patch(`/sales-orders/${order.id}/status`, status === "fulfilled" ? { status, warehouseId: fulfillmentWarehouseId } : { status });
      await refresh();
    }
    catch (e) { setError(messageOf(e)); }
    finally { setBusyId(""); }
  };
  const visible = orders.filter((order) => filter === "all" || order.status === filter);
  const total = visible.filter((order) => order.status !== "cancelled").reduce((sum, order) => sum + Number(order.total), 0);

  return <BaseLayout>
    <div className="flex flex-col gap-6 px-4 lg:px-6">
      <PageHeader title="Sales Orders" description="Track accepted quotations through fulfilment using live order records." action={<Button variant="outline" onClick={() => void refresh()} disabled={loading}><RefreshCw className="size-4" /> Refresh</Button>} />
      {error && <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</div>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Orders shown</p><p className="text-2xl font-semibold tabular-nums">{visible.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Active orders</p><p className="text-2xl font-semibold tabular-nums">{visible.filter((o) => o.status === "confirmed" || o.status === "processing").length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Order value (excludes cancelled)</p><p className="text-2xl font-semibold tabular-nums">{formatKES(total)}</p></CardContent></Card>
      </div>
      <Card><CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between"><div className="flex items-center gap-2 text-sm"><label htmlFor="fulfillment-warehouse" className="text-muted-foreground">Fulfil from</label><select id="fulfillment-warehouse" className="h-9 rounded-md border bg-background px-3 text-sm sm:w-56" value={fulfillmentWarehouseId} onChange={(e) => setFulfillmentWarehouseId(e.target.value)} disabled={warehouses.length === 0}><option value="">Choose warehouse</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>)}</select></div><select className="h-9 rounded-md border bg-background px-3 text-sm sm:w-48" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter order status"><option value="all">All statuses</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        {warehouses.length === 0 && orders.some((order) => order.status === "processing") && <p className="text-sm text-muted-foreground">Create and activate a warehouse before fulfilling stock-tracked sales orders.</p>}
        {loading ? <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div> : visible.length === 0 ? <div className="flex flex-col items-center gap-2 py-12 text-center"><ShoppingCart className="size-8 text-muted-foreground" /><p className="font-medium">{orders.length ? "No orders in this status" : "No sales orders yet"}</p><p className="max-w-lg text-sm text-muted-foreground">{orders.length ? "Choose another filter to see more orders." : "Mark a quotation as sent, then accepted, and use Create order in Quotations. Orders are created from accepted quotations to preserve their agreed prices and line items."}</p></div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Order #</TableHead><TableHead>Customer</TableHead><TableHead>Source quotation</TableHead><TableHead>Order date</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Items</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{visible.map((order) => <TableRow key={order.id}><TableCell className="font-medium">{order.order_number}</TableCell><TableCell>{order.customer_name}</TableCell><TableCell>{order.source_quotation_number ?? "—"}</TableCell><TableCell>{formatDate(order.order_date)}</TableCell><TableCell><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${badge(order.status)}`}>{labels[order.status]}</span></TableCell><TableCell className="text-right tabular-nums">{order.item_count ?? 0}</TableCell><TableCell className="text-right font-medium tabular-nums">{formatKES(Number(order.total))}</TableCell><TableCell><div className="flex justify-end gap-1">{order.status === "confirmed" && <Button size="sm" variant="outline" disabled={busyId === order.id} onClick={() => void changeStatus(order, "processing")}>{busyId === order.id ? <Loader2 className="size-3.5 animate-spin" /> : "Start processing"}</Button>}{order.status === "processing" && <Button size="sm" variant="outline" disabled={!fulfillmentWarehouseId || busyId === order.id} onClick={() => void changeStatus(order, "fulfilled")}><CheckCircle2 className="size-3.5" /> Fulfil</Button>}{(order.status === "confirmed" || order.status === "processing") && <Button size="icon-sm" variant="ghost" aria-label="Cancel order" disabled={busyId === order.id} onClick={() => void changeStatus(order, "cancelled")}><XCircle className="size-4 text-destructive" /></Button>}</div></TableCell></TableRow>)}</TableBody></Table></div>}
      </CardContent></Card>
    </div>
  </BaseLayout>;
}
