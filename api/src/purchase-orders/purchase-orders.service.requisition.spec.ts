import { BadRequestException } from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service.js';

describe('PurchaseOrdersService requisition conversion', () => {
  const user = { userId: 'buyer-1', companyId: 'company-1', branchId: null } as any;

  function setup(requisitionStatus = 'approved') {
    const calls: Array<{sql:string;params?:unknown[]}> = [];
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        calls.push({sql,params});
        if (sql.includes('SELECT id,status,title FROM requisitions')) return {rows:[{id:'req-1',status:requisitionStatus,title:'Workshop supplies'}],rowCount:1};
        if (sql.includes("entity_type='requisition'")) return {rows:[{id:'approval-1'}],rowCount:1};
        if (sql.includes("FROM purchase_orders WHERE company_id=$1 AND requisition_id=$2")) return {rows:[],rowCount:0};
        if (sql.includes("FROM suppliers WHERE")) return {rows:[{id:'supplier-1'}],rowCount:1};
        if (sql.includes('FROM requisition_items ri')) return {rows:[{id:'req-line-1',product_id:'product-1',quantity:4,product_name:'Detergent base',sku:'DB-01',tax_treatment:'standard',tax_rate:16,is_active:true,is_service:false}],rowCount:1};
        if (sql.includes('INSERT INTO purchase_order_sequences')) return {rows:[{next_number:7}],rowCount:1};
        if (sql.includes('SELECT settings FROM companies')) return {rows:[{settings:{}}],rowCount:1};
        if (sql.includes('INSERT INTO purchase_orders')) return {rows:[{id:'po-1'}],rowCount:1};
        return {rows:[],rowCount:1};
      }),
    };
    const db = {transaction:vi.fn(async (callback:(tx:typeof client)=>Promise<unknown>)=>callback(client)),query:vi.fn()};
    const memberships = {getMembershipForCompany:vi.fn().mockResolvedValue({companyId:'company-1',branchId:null})};
    const audit = {logInTransaction:vi.fn().mockResolvedValue(undefined)};
    const accounting = {ensureDefaults:vi.fn()};
    const service = new PurchaseOrdersService(db as any,memberships as any,audit as any,accounting as any);
    vi.spyOn(service,'getById').mockResolvedValue({id:'po-1'} as any);
    return {service,client,db,audit,calls};
  }

  it('creates a draft PO linked to the approved requisition and copies every requested quantity', async () => {
    const {service,client,audit,calls}=setup();
    const result=await service.createFromRequisition(user,{
      requisitionId:'req-1',supplierId:'supplier-1',
      items:[{requisitionItemId:'req-line-1',unitCost:125,taxRate:16}],
    } as any);
    expect(result).toEqual({id:'po-1'});
    expect(calls.some(c=>c.sql.includes('INSERT INTO purchase_orders')&&c.sql.includes('requisition_id'))).toBe(true);
    expect(calls.some(c=>c.sql.includes('INSERT INTO purchase_order_items')&&c.params?.[5]===4&&c.params?.[6]===125)).toBe(true);
    expect(audit.logInTransaction).toHaveBeenCalledWith(client,expect.objectContaining({
      companyId:'company-1',action:'purchase_order.create_from_requisition',entityId:'po-1',
    }));
  });

  it('refuses conversion until the requisition is approved', async () => {
    const {service,client}=setup('pending_approval');
    await expect(service.createFromRequisition(user,{
      requisitionId:'req-1',supplierId:'supplier-1',items:[{requisitionItemId:'req-line-1',unitCost:125}],
    } as any)).rejects.toThrow(BadRequestException);
    expect(client.query.mock.calls.some(([sql])=>String(sql).includes('INSERT INTO purchase_orders'))).toBe(false);
  });

  it('requires all requisition lines exactly once before creating a PO', async () => {
    const {service,client}=setup();
    await expect(service.createFromRequisition(user,{
      requisitionId:'req-1',supplierId:'supplier-1',items:[],
    } as any)).rejects.toThrow('The purchase order must account for every requisition line exactly once.');
    expect(client.query.mock.calls.some(([sql])=>String(sql).includes('INSERT INTO purchase_orders'))).toBe(false);
  });
});
