<script lang="ts">
  import { ShieldOff, TrendingDown, TrendingUp, TriangleAlert } from "lucide-svelte";
  import { getContext } from "svelte";
  import { goto } from "$app/navigation";
  import { invoiceStatusLabel } from "$lib/i18n/mod";

  let { data } = $props();

  let t = getContext("i18n") as (key: string, params?: Record<string, string | number>) => string;
  let numberFormat = $derived(data.localization?.numberFormat || "comma");
  let dateLocale = $derived(data.localization?.locale || "en");
  let numberLocale = $derived(numberFormat === "period" ? "de-DE" : "en-US");
  let stats = $derived(data.stats);
  let user = $derived(data.user);
  let canViewCustomers = $derived(user?.isAdmin || user?.permissions?.some((p) => p.resource === "customers" && p.action === "read"));
  let canViewProducts = $derived(user?.isAdmin || user?.permissions?.some((p) => p.resource === "products" && p.action === "read"));

  function fmtMoney(n: number, compact = false) {
    const cur = stats?.currency || "USD";
    try {
      return new Intl.NumberFormat(numberLocale, {
        style: "currency",
        currency: cur,
        ...(compact ? { notation: "compact", maximumFractionDigits: 1 } : {}),
      }).format(n || 0);
    } catch {
      return `${cur} ${Number(n || 0).toFixed(2)}`;
    }
  }

  function fmtNumber(n: number) {
    return new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 2 }).format(n || 0);
  }

  // Year picker: every year with invoices plus the selected one
  let yearOptions = $derived.by(() => {
    const ys = [...(stats?.years ?? []), new Date().getFullYear()];
    if (stats?.year) ys.push(stats.year);
    return ys.filter((y, i) => ys.indexOf(y) === i).sort((a, b) => b - a);
  });
  let selectedYear = $derived(stats?.year === null ? "all" : String(stats?.year ?? ""));

  function selectYear(e: Event) {
    goto(`?year=${(e.currentTarget as HTMLSelectElement).value}`, { keepFocus: true });
  }

  let growth = $derived.by(() => {
    if (!stats?.previous || !stats.previous.revenue) return null;
    return ((stats.summary.revenue - stats.previous.revenue) / stats.previous.revenue) * 100;
  });

  // Chart: months of the selected year, or one bar per year for "all time"
  let bars = $derived.by(() => {
    if (!stats) return [];
    if (stats.monthly) {
      return stats.monthly.map((m) => ({
        label: new Date(2000, m.month - 1, 1).toLocaleDateString(dateLocale, { month: "short" }),
        longLabel: new Date(stats.year ?? 2000, m.month - 1, 1).toLocaleDateString(dateLocale, { month: "long", year: "numeric" }),
        ...m,
      }));
    }
    return stats.yearly.map((y) => ({ label: String(y.year), longLabel: String(y.year), ...y }));
  });

  // Round the axis maximum up to 1, 2, 2.5 or 5 times a power of ten
  function niceMax(v: number) {
    if (v <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    for (const step of [1, 2, 2.5, 5, 10]) {
      if (step * pow >= v) return step * pow;
    }
    return 10 * pow;
  }
  let axisMax = $derived(niceMax(Math.max(0, ...bars.map((b) => b.revenue))));
  let ticks = $derived([1, 0.75, 0.5, 0.25, 0].map((f) => f * axisMax));
  let hovered = $state<number | null>(null);

  let maxProductRevenue = $derived(Math.max(0, ...(stats?.topProducts ?? []).map((p) => p.revenue)));
  let maxCustomerRevenue = $derived(Math.max(0, ...(stats?.topCustomers ?? []).map((c) => c.revenue)));

  const STATUS_BADGES: Record<string, string> = {
    draft: "badge-ghost",
    sent: "badge-info",
    overdue: "badge-error",
    paid: "badge-success",
    complete: "badge-secondary",
    voided: "badge-neutral",
  };
</script>

<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
  <h1 class="text-2xl font-semibold">{t("Statistics")}</h1>
  {#if stats}
    <label class="flex items-center gap-2 text-sm">
      <span class="opacity-70">{t("Period")}</span>
      <select class="select select-bordered select-sm w-36" value={selectedYear} onchange={selectYear}>
        {#each yearOptions as y (y)}
          <option value={String(y)}>{y}</option>
        {/each}
        <option value="all">{t("All time")}</option>
      </select>
    </label>
  {/if}
</div>

{#if data.forbidden}
  <div class="card bg-base-100 border-base-300 rounded-box mb-4 border">
    <div class="card-body flex flex-row items-center gap-4 p-6">
      <ShieldOff size={24} class="shrink-0 opacity-50" />
      <div>
        <div class="font-semibold">{t("Invoice data hidden")}</div>
        <div class="text-sm opacity-70">
          {t("You do not have permission to view invoices. Contact an administrator to request access.")}
        </div>
      </div>
    </div>
  </div>
{/if}

{#if data.error}
  <div class="alert alert-error mb-4">
    <span>{data.error}</span>
  </div>
{/if}

{#if stats}
  {#if stats.mixedCurrencies}
    <div class="alert alert-warning mb-4">
      <TriangleAlert size={18} />
      <span>{t("Invoices use more than one currency. Amounts are added up without conversion.")}</span>
    </div>
  {/if}

  <div class="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Revenue")}</div>
        <div class="text-xl font-bold sm:text-2xl">{fmtMoney(stats.summary.revenue)}</div>
        {#if growth !== null}
          <div class={`flex items-center gap-1 text-xs ${growth >= 0 ? "text-success" : "text-error"}`}>
            {#if growth >= 0}<TrendingUp size={14} />{:else}<TrendingDown size={14} />{/if}
            <span>
              {growth >= 0 ? "+" : ""}{fmtNumber(Math.round(growth * 10) / 10)}%
              {t("vs. {{year}}", { year: (stats.year ?? 0) - 1 })}
            </span>
          </div>
        {/if}
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Net revenue")}</div>
        <div class="text-xl font-bold sm:text-2xl">{fmtMoney(stats.summary.net)}</div>
        <div class="text-xs opacity-70">{t("Tax")}: {fmtMoney(stats.summary.tax)}</div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Invoices issued")}</div>
        <div class="text-xl font-bold sm:text-2xl">{stats.summary.count}</div>
        <div class="text-xs opacity-70">{t("Average")}: {fmtMoney(stats.summary.average)}</div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Customers billed")}</div>
        <div class="text-xl font-bold sm:text-2xl">{stats.summary.customers}</div>
      </div>
    </div>
  </div>

  <div class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Paid")}</div>
        <div class="text-lg font-semibold sm:text-xl">{fmtMoney(stats.summary.paid)}</div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Outstanding")}</div>
        <div class="text-lg font-semibold sm:text-xl">{fmtMoney(stats.summary.outstanding)}</div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Overdue")}</div>
        <div class={`text-lg font-semibold sm:text-xl ${stats.summary.overdue > 0 ? "text-error" : ""}`}>
          {fmtMoney(stats.summary.overdue)}
        </div>
      </div>
    </div>
    <div class="card bg-base-100 border-base-300 rounded-box border">
      <div class="card-body p-4">
        <div class="text-xs opacity-70 sm:text-sm">{t("Average days to pay")}</div>
        <div class="text-lg font-semibold sm:text-xl">
          {stats.summary.averageDaysToPay === null ? "–" : fmtNumber(stats.summary.averageDaysToPay)}
        </div>
      </div>
    </div>
  </div>

  <div class="card bg-base-100 border-base-300 rounded-box mb-6 border">
    <div class="card-body p-4">
      <h2 class="text-lg font-semibold">{stats.monthly ? t("Sales per month") : t("Sales per year")}</h2>
      <div class="flex gap-2 pt-2">
        <div class="relative w-14 shrink-0 text-right text-xs tabular-nums opacity-60" aria-hidden="true">
          {#each ticks as tick, i (i)}
            <div class="absolute right-0 -translate-y-1/2" style={`top: ${(i / (ticks.length - 1)) * 100}%`}>
              {fmtMoney(tick, true)}
            </div>
          {/each}
        </div>
        <div class="flex-1">
          <div class="relative h-56">
            {#each ticks as _, i (i)}
              <div class="border-base-300 absolute inset-x-0 border-t" style={`top: ${(i / (ticks.length - 1)) * 100}%`}></div>
            {/each}
            <div class="absolute inset-0 flex gap-[2px]" role="list" onmouseleave={() => (hovered = null)}>
              {#each bars as bar, i (bar.label)}
                <div class="relative flex h-full flex-1 items-end justify-center" role="listitem" aria-label={`${bar.longLabel}: ${fmtMoney(bar.revenue)}`} onmouseenter={() => (hovered = i)}>
                  <div
                    class={`bg-primary w-full max-w-12 rounded-t transition-opacity ${hovered !== null && hovered !== i ? "opacity-50" : ""}`}
                    style={`height: ${(bar.revenue / axisMax) * 100}%`}
                  ></div>
                  {#if hovered === i}
                    <div
                      class={`bg-base-100 border-base-300 pointer-events-none absolute z-10 mb-2 w-max rounded-lg border p-2 text-xs shadow ${i < bars.length / 2 ? "left-0" : "right-0"}`}
                      style={`bottom: ${(bar.revenue / axisMax) * 100}%`}
                    >
                      <div class="font-semibold">{bar.longLabel}</div>
                      <div>{t("Revenue")}: {fmtMoney(bar.revenue)}</div>
                      <div class="opacity-70">{t("Paid")}: {fmtMoney(bar.paid)}</div>
                      <div class="opacity-70">{t("Invoices")}: {bar.count}</div>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
          <div class="flex gap-[2px] pt-1 text-xs opacity-60" aria-hidden="true">
            {#each bars as bar (bar.label)}
              <div class="flex-1 truncate text-center">{bar.label}</div>
            {/each}
          </div>
        </div>
      </div>
      <details class="mt-2">
        <summary class="cursor-pointer text-sm opacity-70">{t("Show as table")}</summary>
        <div class="overflow-x-auto">
          <table class="table-sm table w-full">
            <thead>
              <tr>
                <th>{stats.monthly ? t("Month") : t("Year")}</th>
                <th class="text-right">{t("Invoices")}</th>
                <th class="text-right">{t("Revenue")}</th>
                <th class="text-right">{t("Paid")}</th>
              </tr>
            </thead>
            <tbody>
              {#each bars as bar (bar.label)}
                <tr>
                  <td>{bar.longLabel}</td>
                  <td class="text-right tabular-nums">{bar.count}</td>
                  <td class="text-right tabular-nums">{fmtMoney(bar.revenue)}</td>
                  <td class="text-right tabular-nums">{fmtMoney(bar.paid)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  </div>

  <div class="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
    <div>
      <h2 class="mb-3 text-xl font-semibold">{t("Top products")}</h2>
      <div class="bg-base-100 border-base-300 rounded-box overflow-x-auto border">
        <table class="table-sm sm:table-md table w-full">
          <thead>
            <tr class="bg-base-200">
              <th>{t("Product")}</th>
              <th class="text-right">{t("Quantity")}</th>
              <th class="text-right">{t("Revenue")}</th>
            </tr>
          </thead>
          <tbody>
            {#each stats.topProducts as p (p.productId ?? p.name)}
              <tr class="hover">
                <td>
                  {#if p.productId && canViewProducts}
                    <a class="font-medium hover:underline" href={`/products/${p.productId}`}>{p.name}</a>
                  {:else}
                    <span class="font-medium">{p.name}</span>
                  {/if}
                  <div class="bg-base-200 mt-1 h-1 rounded-full">
                    <div class="bg-primary h-1 rounded-full" style={`width: ${maxProductRevenue ? (p.revenue / maxProductRevenue) * 100 : 0}%`}></div>
                  </div>
                </td>
                <td class="text-right tabular-nums">{fmtNumber(p.quantity)}</td>
                <td class="text-right tabular-nums">{fmtMoney(p.revenue)}</td>
              </tr>
            {:else}
              <tr><td colspan="3" class="text-center opacity-60">{t("No data for this period")}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>

    <div>
      <h2 class="mb-3 text-xl font-semibold">{t("Top customers")}</h2>
      <div class="bg-base-100 border-base-300 rounded-box overflow-x-auto border">
        <table class="table-sm sm:table-md table w-full">
          <thead>
            <tr class="bg-base-200">
              <th>{t("Customer")}</th>
              <th class="text-right">{t("Invoices")}</th>
              <th class="text-right">{t("Revenue")}</th>
              <th class="hidden text-right sm:table-cell">{t("Outstanding")}</th>
            </tr>
          </thead>
          <tbody>
            {#each stats.topCustomers as c (c.customerId)}
              <tr class="hover">
                <td>
                  {#if canViewCustomers}
                    <a class="font-medium hover:underline" href={`/customers/${c.customerId}`}>{c.name}</a>
                  {:else}
                    <span class="font-medium">{c.name}</span>
                  {/if}
                  <div class="bg-base-200 mt-1 h-1 rounded-full">
                    <div class="bg-primary h-1 rounded-full" style={`width: ${maxCustomerRevenue ? (c.revenue / maxCustomerRevenue) * 100 : 0}%`}></div>
                  </div>
                </td>
                <td class="text-right tabular-nums">{c.invoices}</td>
                <td class="text-right tabular-nums">{fmtMoney(c.revenue)}</td>
                <td class="hidden text-right tabular-nums sm:table-cell">{fmtMoney(c.outstanding)}</td>
              </tr>
            {:else}
              <tr><td colspan="4" class="text-center opacity-60">{t("No data for this period")}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
    <div>
      <h2 class="mb-3 text-xl font-semibold">{t("Invoices by status")}</h2>
      <div class="bg-base-100 border-base-300 rounded-box overflow-x-auto border">
        <table class="table-sm sm:table-md table w-full">
          <thead>
            <tr class="bg-base-200">
              <th>{t("Status")}</th>
              <th class="text-right">{t("Invoices")}</th>
              <th class="text-right">{t("Amount")}</th>
            </tr>
          </thead>
          <tbody>
            {#each stats.status as s (s.status)}
              <tr>
                <td><div class={`badge badge-sm ${STATUS_BADGES[s.status] ?? ""}`}>{t(invoiceStatusLabel(s.status))}</div></td>
                <td class="text-right tabular-nums">{s.count}</td>
                <td class="text-right tabular-nums">{fmtMoney(s.amount)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>

    <div>
      <h2 class="mb-3 text-xl font-semibold">{t("Payment methods")}</h2>
      <div class="bg-base-100 border-base-300 rounded-box overflow-x-auto border">
        <table class="table-sm sm:table-md table w-full">
          <thead>
            <tr class="bg-base-200">
              <th>{t("Payment method")}</th>
              <th class="text-right">{t("Invoices")}</th>
              <th class="text-right">{t("Amount")}</th>
            </tr>
          </thead>
          <tbody>
            {#each stats.paymentMethods as m (m.method)}
              <tr>
                <td>{m.method || t("Not specified")}</td>
                <td class="text-right tabular-nums">{m.count}</td>
                <td class="text-right tabular-nums">{fmtMoney(m.amount)}</td>
              </tr>
            {:else}
              <tr><td colspan="3" class="text-center opacity-60">{t("No data for this period")}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </div>
{/if}
