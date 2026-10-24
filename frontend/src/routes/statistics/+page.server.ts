import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { backendGet, SESSION_COOKIE } from "$lib/backend";

type Totals = {
  revenue: number;
  net: number;
  tax: number;
  paid: number;
  outstanding: number;
  overdue: number;
  count: number;
};

export type Statistics = {
  year: number | null;
  years: number[];
  currency: string;
  mixedCurrencies: boolean;
  summary: Totals & {
    average: number;
    customers: number;
    averageDaysToPay: number | null;
  };
  previous: Totals | null;
  monthly:
    | { month: number; revenue: number; paid: number; count: number }[]
    | null;
  yearly: { year: number; revenue: number; paid: number; count: number }[];
  status: { status: string; count: number; amount: number }[];
  topProducts: {
    name: string;
    productId: string | null;
    quantity: number;
    revenue: number;
    invoices: number;
  }[];
  topCustomers: {
    customerId: string;
    name: string;
    revenue: number;
    invoices: number;
    outstanding: number;
  }[];
  paymentMethods: { method: string; count: number; amount: number }[];
};

export const load: PageServerLoad = async ({ locals, cookies, url }) => {
  if (!locals.user) {
    throw redirect(303, "/login");
  }

  const user = locals.user;
  const canViewInvoices =
    user.isAdmin ||
    user.permissions?.some(
      (p) => p.resource === "invoices" && p.action === "read",
    );
  if (!canViewInvoices) {
    return { forbidden: true };
  }

  const token = cookies.get(SESSION_COOKIE);
  const auth = token ? `Bearer ${token}` : "";

  const raw = url.searchParams.get("year") || "";
  const year = raw === "all" || /^\d{4}$/.test(raw) ? raw : "";
  const query = year ? `?year=${year}` : "";

  try {
    const stats = (await backendGet(
      `/api/v1/statistics${query}`,
      auth,
    )) as Statistics;
    return { stats };
  } catch (err) {
    return { error: String(err) };
  }
};
