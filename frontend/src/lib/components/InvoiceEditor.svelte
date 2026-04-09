<script lang="ts">
  import { getContext, onMount, untrack } from "svelte";
  import { Plus, GripVertical } from "lucide-svelte";
  import { goto } from "$app/navigation";

  // Override crypto.randomUUID for non HTTPS dev scenario
  if (typeof window !== 'undefined' && !window.crypto.randomUUID) {
    console.warn("Secure context not detected. Polyfilling crypto.randomUUID for development.");
    
    window.crypto.randomUUID = function() {
      return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
        (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
      );
    };
  }

  let { data, invoice = null, formId = "invoice-editor-form" } = $props();
  let initInvoice = untrack(() => invoice);
  let t = getContext("i18n") as (key: string) => string;
  let loc = getContext("localization") as any;

  let saving = $state(false);
  let error = $state("");

  let form = $state({
    customerId: initInvoice?.customerId || "",
    invoiceNumber: initInvoice?.invoiceNumber || "",
    currency: initInvoice?.currency || "EUR",
    status: initInvoice?.status || "draft",
    issueDate: initInvoice?.issueDate ? new Date(initInvoice.issueDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    dueDate: initInvoice?.dueDate ? new Date(initInvoice.dueDate).toISOString().slice(0, 10) : "",
    taxMode: initInvoice?.taxMode || "invoice",
    taxRate: initInvoice?.taxRate || 0,
    pricesIncludeTax: initInvoice?.pricesIncludeTax ? "true" : "false",
    roundingMode: initInvoice?.roundingMode || "line",
    paymentTerms: initInvoice?.paymentTerms || "",
    notes: initInvoice?.notes || ""
  });

  let items = $state(
    initInvoice?.items?.length
      ? initInvoice.items.map((i: any) => ({...i, id: crypto.randomUUID()}))
      : [{ id: crypto.randomUUID(), description: "", quantity: 1, unitPrice: 0, taxPercent: 0, notes: "" }]
  );

  let customers = $derived(data.customers || []);
  let products = $derived(data.products || []);
  let taxDefinitions = $derived(data.taxDefinitions || []);

  function addProduct() {
  }

  function addItem() {
    items.push({ id: crypto.randomUUID(), description: "", quantity: 1, unitPrice: 0, taxPercent: 0, notes: "" });
  }

  function removeItem(index: number) {
    if (items.length > 1) items.splice(index, 1);
  }

  let draggedId = $state<string | null>(null);
  let dragHoverId = $state<string | null>(null);

  function handleDragStart(e: DragEvent, id: string) {
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    }
    // Defer setting the state to avoid firing dragend immediately
    setTimeout(() => { draggedId = id; }, 0);
  }

  function handleDragOver(e: DragEvent, id: string) {
    e.preventDefault();
    if (!draggedId || draggedId === id) return;
    dragHoverId = id;
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
  }

  function handleDragLeave(id: string) {
    if (dragHoverId === id) {
      dragHoverId = null;
    }
  }

  function handleDrop(e: DragEvent, targetId: string) {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) {
      draggedId = null;
      dragHoverId = null;
      return;
    }

    const fromIndex = items.findIndex((i: any) => i.id === draggedId);
    const toIndex = items.findIndex((i: any) => i.id === targetId);

    if (fromIndex !== -1 && toIndex !== -1) {
      const removed = items.splice(fromIndex, 1)[0];
      items.splice(toIndex, 0, removed);
    }

    draggedId = null;
    dragHoverId = null;
  }

  function handleDragEnd() {
    draggedId = null;
    dragHoverId = null;
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      handleSubmit(e as unknown as SubmitEvent);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      addItem();
    }
  }

  let subtotal = $derived(items.reduce((sum, item) => sum + ((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)), 0));
  let tax = $derived(form.taxMode === "invoice" ? subtotal * ((Number(form.taxRate) || 0) / 100) : items.reduce((sum, item) => sum + (((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)) * ((Number(item.taxPercent) || 0) / 100)), 0));
  let total = $derived(form.pricesIncludeTax === "true" ? subtotal : subtotal + tax); // Simplified for visual parity

  async function handleSubmit(e: SubmitEvent | Event) {
    if (e && "preventDefault" in e) e.preventDefault();
    saving = true;
    error = "";

    try {
      const payload = { ...form, pricesIncludeTax: form.pricesIncludeTax === "true", items: items.map(i => ({ description: i.description, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), taxPercent: Number(i.taxPercent||0), notes: i.notes })) };
      const url = initInvoice ? "/api/v1/invoices/" + initInvoice.id : "/api/v1/invoices";
      const res = await fetch(url, {
        method: initInvoice ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        const d = await res.text();
        let errMsg = "Failed to save invoice";
        try { const j = JSON.parse(d); errMsg = j.error || errMsg; } catch {}
        throw new Error(errMsg);
      }

      const txt = await res.text();
      let result;
      try {
        result = JSON.parse(txt);
      } catch (err: any) {
        throw new Error("JSON parse error: " + err.message + " (Response: " + txt.substring(0, 100) + " )");
      }
      goto("/invoices/" + result.id);
    } catch(err: any) {
      error = err.message;
    } finally {
      saving = false;
    }
  }

  let productModal;

  function addProductModal() {
    productModal.showModal();
  }

  function fmtMoney(cur: string | undefined, n: number) {
    if (!cur) cur = "USD";
    try {
      const locale = numberFormat === "period" ? "de-DE" : "en-US";
      return new Intl.NumberFormat(locale, { style: "currency", currency: cur }).format(n || 0);
    } catch {
      return `${cur} ${Number(n || 0).toFixed(2)}`;
    }
  }

  onMount(() => {
    //
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<dialog bind:this={productModal} class="modal">
  <div class="modal-box w-11/12 max-w-2xl">
    <h3 class="text-lg font-bold mb-4">{t("Select product")}</h3>
    <div class="hidden md:block overflow-x-auto rounded-box bg-base-100 border border-base-300">
      <table class="table table-zebra w-full text-sm">
        <thead class="bg-base-200 text-base-content">
          <tr class="font-medium">
            <th>{t("Name")}</th>
            <th>{t("Description")}</th>
            <th class="w-24 text-right pr-4">{t("Price")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each products as p}
            <tr class="hover">
              <td class="max-w-[12rem] truncate">{p.name || p.id}</td>
              <td class="opacity-70 max-w-[20rem] truncate">{p.description || ""}</td>
              <td class="text-right pr-4 font-medium">{fmtMoney(p.currency, p.price)}</td>
              <td class="text-right pr-4 font-medium">
                <button type="button" class="btn btn-ghost btn-sm shrink-0" onclick={addProduct}>
                  <Plus size={16} />
                  <span class="ml-2">{t("Add Product")}</span>
                </button>
              </td>
            </tr>
          {/each}
          {#if products.length === 0}
            <tr>
              <td colspan="3" class="text-center py-10 text-sm opacity-70">
                <span>
                  {t("No products yet.")}
                </span>
              </td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>
    
    <div class="modal-action">
      <form method="dialog">
        <button class="btn">Close</button>
      </form>
    </div>
  </div>
  
  <form method="dialog" class="modal-backdrop">
    <button>close</button>
  </form>
</dialog>

<form id={formId} onsubmit={handleSubmit} class="space-y-6">
  {#if error}
    <div class="alert alert-error">{error}</div>
  {/if}

  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Customer")} <span class="text-error">*</span></span>
      </div>
      <select class="select select-bordered w-full" bind:value={form.customerId} required>
        <option value="">{t("Select customer")}</option>
        {#each customers as c}
          <option value={c.id}>{c.name}</option>
        {/each}
      </select>
    </label>

    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Invoice Number")}</span>
      </div>
      <input type="text" class="input input-bordered w-full" placeholder={t("e.g. INV-2025-001")} bind:value={form.invoiceNumber} />
    </label>

    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Currency")}</span>
      </div>
      <input type="text" class="input input-bordered w-full" bind:value={form.currency} />
    </label>

    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Status")}</span>
      </div>
      <select class="select select-bordered w-full" bind:value={form.status}>
        <option value="draft">{t("Draft")}</option>
        <option value="sent">{t("Sent")}</option>
        <option value="paid">{t("Paid")}</option>
        <option value="complete">{t("Complete")}</option>
        <option value="overdue">{t("Overdue")}</option>
        <option value="voided">{t("Voided")}</option>
      </select>
    </label>
  </div>

  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Issue Date")}</span>
      </div>
      <input type="date" class="input input-bordered w-full" bind:value={form.issueDate} required />
    </label>

    <label class="form-control">
      <div class="label">
        <span class="label-text">{t("Due Date")}</span>
      </div>
      <input type="date" class="input input-bordered w-full" bind:value={form.dueDate} />
    </label>
  </div>

  <div>
    <div class="flex items-center justify-between mb-2">
      <div class="block text-sm font-semibold">
        {t("Items")} <span class="text-error">*</span>
        <span class="ml-2 text-xs opacity-50 font-normal">({t("Ctrl/Cmd+Enter to add")})</span>
      </div>
      <button type="button" class="btn btn-sm" onclick={addItem}>
        <Plus size={16} />
        <span class="ml-2">{t("Add item")}</span>
      </button>
    </div>

    <div class="hidden lg:flex flex-row flex-nowrap items-center gap-2 mb-1 text-xs opacity-60 font-medium">
      <div class="w-6 shrink-0"></div>
      <div class="flex-1 min-w-0 pl-3">{t("Description")}</div>
      <div class="w-16 sm:w-20 shrink-0 text-center">{t("Quantity")}</div>
      <div class="w-24 shrink-0 text-center">{t("Price")}</div>
      {#if form.taxMode === "line"}
        <div class="w-20 shrink-0 text-center">{t("Tax %")}</div>
      {/if}
      <div class="w-40 max-w-xs shrink-0 text-center">{t("Notes")}</div>
      <div class="w-8 shrink-0"></div>
    </div>

    <div class="space-y-3" role="list">
      {#each items as item, i (item.id)}
        <div role="listitem"
             class="flex flex-nowrap items-center gap-2 p-1 rounded-box transition-colors {draggedId === item.id ? 'opacity-50' : ''} {dragHoverId === item.id ? 'bg-base-200' : ''}"
             draggable="true"
             ondragstart={(e) => handleDragStart(e, item.id)}
             ondragover={(e) => handleDragOver(e, item.id)}
             ondragleave={() => handleDragLeave(item.id)}
             ondrop={(e) => handleDrop(e, item.id)}
             ondragend={handleDragEnd}>
          <button type="button" class="btn btn-ghost btn-sm btn-square shrink-0 cursor-move opacity-40 hover:opacity-100" tabindex="-1">
            <GripVertical size={16} />
          </button>

          <button type="button" class="btn btn-ghost btn-sm shrink-0" onclick={addProductModal}>
            <Plus size={16} />
            <span class="ml-2">{t("Add Product")}</span>
          </button>
          <div class="form-control w-full">
            <input class="input input-bordered w-full min-w-10" bind:value={item.description} placeholder={t("Description")} required />
          </div>
          
          <input type="number" min="0" step="1" class="input input-bordered w-16 sm:w-20 shrink-0 text-center" bind:value={item.quantity} />
          <input type="number" min="0" step="any" class="input input-bordered w-24 shrink-0 text-center" bind:value={item.unitPrice} />
          {#if form.taxMode === "line"}
            <input type="number" min="0" step="any" class="input input-bordered w-20 shrink-0 text-center" bind:value={item.taxPercent} placeholder="%" />
          {/if}
          <input class="input input-bordered w-40 max-w-xs shrink-0" bind:value={item.notes} placeholder={t("Notes")} />
          
          <button type="button" class="btn btn-ghost btn-square btn-sm shrink-0" onclick={() => removeItem(i)} aria-label={t("Remove item")}>&times;</button>
        </div>
      {/each}
    </div>

    <div class="mt-6 flex flex-col items-end space-y-2 text-sm">
      <div class="flex justify-between w-48">
        <span>{t("Subtotal")}:</span>
        <span>{subtotal.toFixed(2)}</span>
      </div>
      {#if tax > 0}
      <div class="flex justify-between w-48">
        <span>{t("Tax")}:</span>
        <span>{tax.toFixed(2)}</span>
      </div>
      {/if}
      <div class="flex justify-between w-48 font-bold text-lg">
        <span>{t("Total")}:</span>
        <span>{total.toFixed(2)} {form.currency}</span>
      </div>
    </div>
  </div>

  <div class="flex gap-4 text-xs opacity-50">
    <span class="flex items-center gap-1"><kbd class="kbd kbd-xs">Ctrl</kbd>+<kbd class="kbd kbd-xs">S</kbd> {t("Save")}</span>
    <span class="flex items-center gap-1"><kbd class="kbd kbd-xs">Ctrl</kbd>+<kbd class="kbd kbd-xs">Enter</kbd> {t("Add item")}</span>
  </div>

  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
    <label class="form-control">
      <div class="label"><span class="label-text">{t("Tax Mode")}</span></div>
      <select class="select select-bordered w-full" bind:value={form.taxMode}>
        <option value="invoice">{t("Invoice total")}</option>
        <option value="line">{t("Per line")}</option>
      </select>
    </label>
    
    <label class="form-control" class:hidden={form.taxMode !== 'invoice'}>
      <div class="label"><span class="label-text">{t("Tax Rate (%)")}</span></div>
      <input type="number" class="input input-bordered w-full" bind:value={form.taxRate} step="any" min="0" />
    </label>

    <label class="form-control">
      <div class="label"><span class="label-text">{t("Prices include tax?")}</span></div>
      <select class="select select-bordered w-full" bind:value={form.pricesIncludeTax}>
        <option value="false">{t("No")}</option>
        <option value="true">{t("Yes")}</option>
      </select>
    </label>

    <label class="form-control">
      <div class="label"><span class="label-text">{t("Rounding mode")}</span></div>
      <select class="select select-bordered w-full" bind:value={form.roundingMode}>
        <option value="line">{t("Round per line")}</option>
        <option value="total">{t("Round on total")}</option>
      </select>
    </label>
  </div>

  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    <label class="form-control">
      <div class="label"><span class="label-text">{t("Payment Terms")}</span></div>
      <textarea class="textarea textarea-bordered w-full h-24" bind:value={form.paymentTerms}></textarea>
    </label>
    
    <label class="form-control">
      <div class="label"><span class="label-text">{t("Notes")}</span></div>
      <textarea class="textarea textarea-bordered w-full h-24" bind:value={form.notes}></textarea>
    </label>
  </div>
</form>
