import { getDatabase } from "../database/init.ts";
import { getInvoices, getLatestPaidPaymentMethods } from "./invoices.ts";
import { Invoice } from "../types/index.ts";

// Drafts were never issued and voided invoices were cancelled, so neither
// counts as a sale.
const isIssued = (inv: Invoice) =>
  inv.status !== "draft" && inv.status !== "voided";
const isPaid = (inv: Invoice) =>
  inv.status === "paid" || inv.status === "complete";
const isOpen = (inv: Invoice) =>
  inv.status === "sent" || inv.status === "overdue";

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => Number(v) || 0;

type PeriodTotals = {
  revenue: number;
  net: number;
  tax: number;
  paid: number;
  outstanding: number;
  overdue: number;
  count: number;
};

function totals(invoices: Invoice[]): PeriodTotals {
  const t: PeriodTotals = {
    revenue: 0,
    net: 0,
    tax: 0,
    paid: 0,
    outstanding: 0,
    overdue: 0,
    count: 0,
  };
  for (const inv of invoices) {
    if (!isIssued(inv)) continue;
    const total = num(inv.total);
    const tax = num(inv.taxAmount);
    t.revenue += total;
    t.tax += tax;
    t.net += total - tax;
    t.count++;
    if (isPaid(inv)) t.paid += total;
    if (isOpen(inv)) t.outstanding += total;
    if (inv.status === "overdue") t.overdue += total;
  }
  return {
    revenue: r2(t.revenue),
    net: r2(t.net),
    tax: r2(t.tax),
    paid: r2(t.paid),
    outstanding: r2(t.outstanding),
    overdue: r2(t.overdue),
    count: t.count,
  };
}

const yearOf = (inv: Invoice) => inv.issueDate.getUTCFullYear();

/** Days from issue to the first time each invoice was marked paid. */
function averageDaysToPay(invoices: Invoice[]): number | null {
  const paid = invoices.filter(isPaid);
  if (paid.length === 0) return null;
  const db = getDatabase();
  const placeholders = paid.map(() => "?").join(", ");
  const rows = db.query(
    `SELECT invoice_id, MIN(changed_at)
     FROM invoice_status_history
     WHERE status = 'paid' AND invoice_id IN (${placeholders})
     GROUP BY invoice_id`,
    paid.map((i) => i.id),
  ) as unknown[][];
  const paidAt = new Map(rows.map((r) => [String(r[0]), String(r[1])]));
  const days: number[] = [];
  for (const inv of paid) {
    const at = paidAt.get(inv.id);
    if (!at) continue;
    const d = (new Date(at).getTime() - inv.issueDate.getTime()) / 86_400_000;
    if (isFinite(d)) days.push(Math.max(0, d));
  }
  if (days.length === 0) return null;
  return Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10;
}

function topProducts(year: number | null, limit = 10) {
  const db = getDatabase();
  const rows = db.query(
    `SELECT COALESCE(p.name, ii.description) AS name,
            ii.product_id,
            SUM(ii.quantity) AS quantity,
            SUM(ii.line_total) AS revenue,
            COUNT(DISTINCT ii.invoice_id) AS invoices
     FROM invoice_items ii
     JOIN invoices i ON i.id = ii.invoice_id
     LEFT JOIN products p ON p.id = ii.product_id
     WHERE i.status NOT IN ('draft', 'voided')
       AND (? IS NULL OR substr(i.issue_date, 1, 4) = ?)
     GROUP BY COALESCE(ii.product_id, ii.description)
     ORDER BY revenue DESC
     LIMIT ?`,
    [year === null ? null : String(year), String(year ?? ""), limit],
  ) as unknown[][];
  return rows.map((r) => ({
    name: String(r[0] ?? ""),
    productId: r[1] ? String(r[1]) : null,
    quantity: r2(num(r[2])),
    revenue: r2(num(r[3])),
    invoices: num(r[4]),
  }));
}

function topCustomers(invoices: Invoice[], limit = 10) {
  const db = getDatabase();
  const names = new Map(
    (db.query("SELECT id, name FROM customers") as unknown[][]).map((r) => [
      String(r[0]),
      String(r[1] ?? ""),
    ]),
  );
  const byCustomer = new Map<
    string,
    { revenue: number; invoices: number; outstanding: number }
  >();
  for (const inv of invoices) {
    if (!isIssued(inv)) continue;
    const e = byCustomer.get(inv.customerId) ??
      { revenue: 0, invoices: 0, outstanding: 0 };
    e.revenue += num(inv.total);
    e.invoices++;
    if (isOpen(inv)) e.outstanding += num(inv.total);
    byCustomer.set(inv.customerId, e);
  }
  return [...byCustomer.entries()]
    .map(([id, e]) => ({
      customerId: id,
      name: names.get(id) ?? "",
      revenue: r2(e.revenue),
      invoices: e.invoices,
      outstanding: r2(e.outstanding),
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

function paymentMethods(invoices: Invoice[]) {
  const paid = invoices.filter(isPaid);
  const methods = getLatestPaidPaymentMethods(paid.map((i) => i.id));
  const agg = new Map<string, { count: number; amount: number }>();
  for (const inv of paid) {
    const m = methods.get(inv.id) ?? "";
    const e = agg.get(m) ?? { count: 0, amount: 0 };
    e.count++;
    e.amount += num(inv.total);
    agg.set(m, e);
  }
  return [...agg.entries()]
    .map(([method, e]) => ({ method, count: e.count, amount: r2(e.amount) }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Sales statistics for one calendar year (by issue date), or for all time
 * when `year` is null.
 */
export function getStatistics(year: number | null) {
  const all = getInvoices();
  const inPeriod = year === null
    ? all
    : all.filter((inv) => yearOf(inv) === year);

  const years = [...new Set(all.map(yearOf))]
    .filter((y) => isFinite(y))
    .sort((a, b) => b - a);

  // Amounts are summed as-is; the dominant currency is reported so the UI can
  // format them and warn when invoices use more than one.
  const currencyCounts = new Map<string, number>();
  for (const inv of all) {
    const c = inv.currency || "USD";
    currencyCounts.set(c, (currencyCounts.get(c) ?? 0) + 1);
  }
  const currency =
    [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";

  const summary = totals(inPeriod);
  const previous = year === null
    ? null
    : totals(all.filter((inv) => yearOf(inv) === year - 1));
  const customersBilled = new Set(
    inPeriod.filter(isIssued).map((i) => i.customerId),
  ).size;

  const monthly = year === null ? null : Array.from(
    { length: 12 },
    (_, m) => {
      const t = totals(
        inPeriod.filter((inv) => inv.issueDate.getUTCMonth() === m),
      );
      return { month: m + 1, revenue: t.revenue, paid: t.paid, count: t.count };
    },
  );

  const yearly = [...years].reverse().map((y) => {
    const t = totals(all.filter((inv) => yearOf(inv) === y));
    return { year: y, revenue: t.revenue, paid: t.paid, count: t.count };
  });

  const statuses = [
    "draft",
    "sent",
    "overdue",
    "paid",
    "complete",
    "voided",
  ] as const;
  const status = statuses.map((s) => {
    const list = inPeriod.filter((inv) => inv.status === s);
    return {
      status: s,
      count: list.length,
      amount: r2(list.reduce((a, i) => a + num(i.total), 0)),
    };
  });

  return {
    year,
    years,
    currency,
    mixedCurrencies: currencyCounts.size > 1,
    summary: {
      ...summary,
      average: summary.count ? r2(summary.revenue / summary.count) : 0,
      customers: customersBilled,
      averageDaysToPay: averageDaysToPay(inPeriod),
    },
    previous,
    monthly,
    yearly,
    status,
    topProducts: topProducts(year),
    topCustomers: topCustomers(inPeriod),
    paymentMethods: paymentMethods(inPeriod),
  };
}
