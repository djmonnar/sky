/* ============================================================
   데이터 저장소 추상화 (data layer)

   UI/스토어는 이 Repository 인터페이스만 사용합니다.
   Firebase/Supabase로 전환할 때는 createMockRepository()를
   같은 인터페이스를 구현한 createFirebaseRepository() 등으로
   교체하면 되고, 화면 코드는 수정할 필요가 없습니다.
   ============================================================ */

import {
  Employee, InventoryCategoryItem, InventoryItem, Recipe, Reservation, Shift, WorkRecord, PayrollRow, Notice, Vendor,
  PurchaseOrder,
  SalesOrder, SalesSyncRun,
} from "./types";
import {
  EMPLOYEES, SEED_RESERVATIONS, SEED_SHIFTS, SEED_RECORDS,
  SEED_PAYROLL, SEED_NOTICES, SEED_HANDOVERS, SEED_VENDORS, SEED_RECIPES,
  SEED_INVENTORY_CATEGORIES, SEED_INVENTORY_ITEMS, SEED_PURCHASE_ORDERS,
  SEED_SALES_ORDERS, SEED_SALES_SYNC_RUNS,
} from "./mock";

export interface Repository {
  listEmployees(): Promise<Employee[]>;
  saveEmployee(e: Employee): Promise<void>;
  deleteEmployee(id: number): Promise<void>;

  listReservations(): Promise<Reservation[]>;
  saveReservation(r: Reservation): Promise<void>;
  deleteReservation(id: number): Promise<void>;

  listShifts(): Promise<Shift[]>;
  saveShift(s: Shift): Promise<void>;
  deleteShift(id: string): Promise<void>;

  listRecords(): Promise<WorkRecord[]>;
  addRecord(r: WorkRecord): Promise<void>;
  updateRecord(id: number, patch: Partial<WorkRecord>): Promise<void>;

  listPayroll(): Promise<PayrollRow[]>;
  updatePayroll(empId: number, patch: Partial<PayrollRow>): Promise<void>;

  listNotices(): Promise<Notice[]>;
  saveNotice(n: Notice): Promise<void>;
  deleteNotice(id: number): Promise<void>;
  listHandovers(): Promise<Notice[]>;
  saveHandover(n: Notice): Promise<void>;
  deleteHandover(id: number): Promise<void>;
  addHandover(n: Notice): Promise<void>;

  listVendors(): Promise<Vendor[]>;
  saveVendor(v: Vendor): Promise<void>;
  deleteVendor(id: number): Promise<void>;

  listInventoryCategories(): Promise<InventoryCategoryItem[]>;
  saveInventoryCategory(category: InventoryCategoryItem): Promise<void>;
  deleteInventoryCategory(id: string): Promise<void>;

  listInventoryItems(): Promise<InventoryItem[]>;
  saveInventoryItem(item: InventoryItem): Promise<void>;
  deleteInventoryItem(id: number): Promise<void>;

  listPurchaseOrders(): Promise<PurchaseOrder[]>;
  savePurchaseOrder(order: PurchaseOrder): Promise<void>;
  deletePurchaseOrder(id: number): Promise<void>;

  listRecipes(): Promise<Recipe[]>;
  saveRecipe(r: Recipe): Promise<void>;
  deleteRecipe(id: number): Promise<void>;

  listSalesOrders(): Promise<SalesOrder[]>;
  listSalesSyncRuns(): Promise<SalesSyncRun[]>;
}

/** 인메모리 목업 구현 — 새로고침 시 초기화됨 */
export function createMockRepository(): Repository {
  const db = {
    employees: structuredClone(EMPLOYEES),
    reservations: structuredClone(SEED_RESERVATIONS),
    shifts: structuredClone(SEED_SHIFTS),
    records: structuredClone(SEED_RECORDS),
    payroll: structuredClone(SEED_PAYROLL),
    notices: structuredClone(SEED_NOTICES),
    handovers: structuredClone(SEED_HANDOVERS),
    vendors: structuredClone(SEED_VENDORS),
    inventoryCategories: structuredClone(SEED_INVENTORY_CATEGORIES),
    inventoryItems: structuredClone(SEED_INVENTORY_ITEMS),
    purchaseOrders: structuredClone(SEED_PURCHASE_ORDERS),
    recipes: structuredClone(SEED_RECIPES),
    salesOrders: structuredClone(SEED_SALES_ORDERS),
    salesSyncRuns: structuredClone(SEED_SALES_SYNC_RUNS),
  };

  return {
    async listEmployees() { return [...db.employees]; },
    async saveEmployee(e) {
      const i = db.employees.findIndex((x) => x.id === e.id);
      if (i === -1) db.employees.push(e);
      else db.employees[i] = e;
    },
    async deleteEmployee(id) {
      const i = db.employees.findIndex((x) => x.id === id);
      if (i !== -1) db.employees.splice(i, 1);
    },

    async listReservations() { return [...db.reservations]; },
    async saveReservation(r) {
      const i = db.reservations.findIndex((x) => x.id === r.id);
      if (i === -1) db.reservations.push(r);
      else db.reservations[i] = r;
    },
    async deleteReservation(id) {
      const i = db.reservations.findIndex((x) => x.id === id);
      if (i !== -1) db.reservations.splice(i, 1);
    },

    async listShifts() { return [...db.shifts]; },
    async saveShift(s) {
      const i = db.shifts.findIndex((x) => x.id === s.id);
      if (i === -1) db.shifts.push(s);
      else db.shifts[i] = s;
    },
    async deleteShift(id) {
      const i = db.shifts.findIndex((x) => x.id === id);
      if (i !== -1) db.shifts.splice(i, 1);
    },

    async listRecords() { return [...db.records]; },
    async addRecord(r) { db.records.push(r); },
    async updateRecord(id, patch) {
      const i = db.records.findIndex((x) => x.id === id);
      if (i !== -1) db.records[i] = { ...db.records[i], ...patch };
    },

    async listPayroll() { return [...db.payroll]; },
    async updatePayroll(empId, patch) {
      const i = db.payroll.findIndex((x) => x.empId === empId);
      if (i !== -1) db.payroll[i] = { ...db.payroll[i], ...patch };
    },

    async listNotices() { return [...db.notices]; },
    async saveNotice(n) {
      const i = db.notices.findIndex((x) => x.id === n.id);
      if (i === -1) db.notices.unshift(n);
      else db.notices[i] = n;
    },
    async deleteNotice(id) {
      const i = db.notices.findIndex((x) => x.id === id);
      if (i !== -1) db.notices.splice(i, 1);
    },
    async listHandovers() { return [...db.handovers]; },
    async saveHandover(n) {
      const i = db.handovers.findIndex((x) => x.id === n.id);
      if (i === -1) db.handovers.unshift(n);
      else db.handovers[i] = n;
    },
    async deleteHandover(id) {
      const i = db.handovers.findIndex((x) => x.id === id);
      if (i !== -1) db.handovers.splice(i, 1);
    },
    async addHandover(n) { db.handovers.unshift(n); },

    async listVendors() { return [...db.vendors]; },
    async saveVendor(v) {
      const i = db.vendors.findIndex((x) => x.id === v.id);
      if (i === -1) db.vendors.unshift(v);
      else db.vendors[i] = v;
    },
    async deleteVendor(id) {
      const i = db.vendors.findIndex((x) => x.id === id);
      if (i !== -1) db.vendors.splice(i, 1);
    },

    async listInventoryCategories() { return [...db.inventoryCategories]; },
    async saveInventoryCategory(category) {
      const i = db.inventoryCategories.findIndex((x) => x.id === category.id);
      if (i === -1) db.inventoryCategories.push(category);
      else db.inventoryCategories[i] = category;
    },
    async deleteInventoryCategory(id) {
      const i = db.inventoryCategories.findIndex((x) => x.id === id);
      if (i !== -1) db.inventoryCategories.splice(i, 1);
    },

    async listInventoryItems() { return [...db.inventoryItems]; },
    async saveInventoryItem(item) {
      const i = db.inventoryItems.findIndex((x) => x.id === item.id);
      if (i === -1) db.inventoryItems.unshift(item);
      else db.inventoryItems[i] = item;
    },
    async deleteInventoryItem(id) {
      const i = db.inventoryItems.findIndex((x) => x.id === id);
      if (i !== -1) db.inventoryItems.splice(i, 1);
    },

    async listPurchaseOrders() { return [...db.purchaseOrders]; },
    async savePurchaseOrder(order) {
      const i = db.purchaseOrders.findIndex((x) => x.id === order.id);
      if (i === -1) db.purchaseOrders.unshift(order);
      else db.purchaseOrders[i] = order;
    },
    async deletePurchaseOrder(id) {
      const i = db.purchaseOrders.findIndex((x) => x.id === id);
      if (i !== -1) db.purchaseOrders.splice(i, 1);
    },

    async listRecipes() { return [...db.recipes]; },
    async saveRecipe(r) {
      const i = db.recipes.findIndex((x) => x.id === r.id);
      if (i === -1) db.recipes.unshift(r);
      else db.recipes[i] = r;
    },
    async deleteRecipe(id) {
      const i = db.recipes.findIndex((x) => x.id === id);
      if (i !== -1) db.recipes.splice(i, 1);
    },

    async listSalesOrders() { return [...db.salesOrders]; },
    async listSalesSyncRuns() { return [...db.salesSyncRuns]; },
  };
}

/** 앱 전역에서 사용하는 저장소 인스턴스 (전환 지점) */
export const repository: Repository = createMockRepository();
