<script lang="ts">
  import { getContext, tick } from "svelte";
  import { ChevronsUpDown, X } from "lucide-svelte";
  import { COUNTRY_CODES, countryName, flagUrl, normalizeCountryCode } from "$lib/countries";

  let {
    value = $bindable(""),
    name = undefined,
    id = "country-select",
    size = "md",
    disabled = false,
    required = false,
    placeholder = undefined,
  }: {
    value?: string;
    name?: string;
    id?: string;
    size?: "sm" | "md";
    disabled?: boolean;
    required?: boolean;
    placeholder?: string;
  } = $props();

  let t = getContext("i18n") as (key: string) => string;
  const getLoc = getContext("localization") as (() => any) | undefined;

  let input: HTMLInputElement | undefined = $state();
  let listEl: HTMLUListElement | undefined = $state();
  let open = $state(false);
  let query = $state("");
  let activeIndex = $state(0);

  let locale = $derived(getLoc?.()?.locale);
  let countries = $derived(COUNTRY_CODES.map((code) => ({ code, name: countryName(code, locale) })).sort((a, b) => a.name.localeCompare(b.name, locale)));

  let selectedCode = $derived(normalizeCountryCode(value));
  let selectedLabel = $derived.by(() => {
    if (!selectedCode) return "";
    const n = countryName(selectedCode, locale);
    return n === selectedCode ? n : `${n} (${selectedCode})`;
  });
  let selectedFlag = $derived(flagUrl(selectedCode));

  // An exact code match ("de") is ranked first, then name/code substring matches.
  let results = $derived.by(() => {
    const q = query.toLowerCase().trim();
    if (!q) return countries;
    const exact = countries.filter((c) => c.code.toLowerCase() === q);
    const rest = countries.filter((c) => c.code.toLowerCase() !== q && (c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)));
    return [...exact, ...rest];
  });

  $effect(() => {
    if (!open) query = selectedLabel;
  });

  $effect(() => {
    input?.setCustomValidity(required && !selectedCode ? t("Select country") : "");
  });

  function openList() {
    if (open || disabled) return;
    open = true;
    query = "";
    activeIndex = Math.max(
      0,
      results.findIndex((c) => c.code === selectedCode),
    );
    scrollActiveIntoView();
  }

  function close() {
    open = false;
  }

  function select(code: string) {
    value = code;
    close();
  }

  function clear() {
    value = "";
    query = "";
    input?.focus();
  }

  async function scrollActiveIntoView() {
    await tick();
    listEl?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }

  function handleKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) return openList();
        activeIndex = Math.min(activeIndex + 1, results.length - 1);
        scrollActiveIntoView();
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) return openList();
        activeIndex = Math.max(activeIndex - 1, 0);
        scrollActiveIntoView();
        break;
      case "Enter":
        if (open) {
          e.preventDefault();
          if (results[activeIndex]) select(results[activeIndex].code);
        }
        break;
      case "Escape":
        if (open) {
          e.preventDefault();
          close();
        }
        break;
      case "Tab":
        close();
        break;
    }
  }
</script>

<div class="relative">
  {#if name}
    <input type="hidden" {name} value={selectedCode} />
  {/if}
  <div class="input input-bordered flex w-full items-center gap-2" class:input-sm={size === "sm"} class:input-disabled={disabled}>
    {#if selectedFlag && !open}
      <img src={selectedFlag} alt="" class="h-3 w-4 shrink-0 rounded-[2px] object-cover shadow-[0_0_0_1px_rgba(0,0,0,0.1)]" />
    {/if}
    <input
      bind:this={input}
      {id}
      type="text"
      class="min-w-0 grow"
      role="combobox"
      aria-expanded={open}
      aria-controls="{id}-listbox"
      aria-autocomplete="list"
      aria-activedescendant={open && results[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
      autocomplete="off"
      {disabled}
      placeholder={selectedLabel || placeholder || t("Select country")}
      bind:value={query}
      onfocus={openList}
      onclick={openList}
      onblur={close}
      oninput={() => {
        open = true;
        activeIndex = 0;
      }}
      onkeydown={handleKeydown}
    />
    {#if selectedCode && !disabled}
      <button type="button" class="opacity-50 hover:opacity-100" tabindex="-1" aria-label={t("Clear")} onmousedown={(e) => e.preventDefault()} onclick={clear}>
        <X size={16} />
      </button>
    {:else}
      <ChevronsUpDown size={16} class="opacity-50" />
    {/if}
  </div>

  {#if open}
    <ul bind:this={listEl} id="{id}-listbox" role="listbox" class="menu bg-base-100 rounded-box border-base-300 absolute z-20 mt-1 max-h-72 w-full flex-nowrap overflow-y-auto border p-1 shadow-lg">
      {#each results as c, i (c.code)}
        <li role="option" id="{id}-option-{i}" data-index={i} aria-selected={c.code === selectedCode}>
          <!-- mousedown is prevented so the input keeps focus and doesn't close the list before the click lands -->
          <button
            type="button"
            tabindex="-1"
            class="flex items-center gap-2"
            class:menu-active={i === activeIndex}
            onmousedown={(e) => e.preventDefault()}
            onmouseenter={() => (activeIndex = i)}
            onclick={() => select(c.code)}
          >
            <img src={flagUrl(c.code)} alt="" class="h-3 w-4 shrink-0 rounded-[2px] object-cover shadow-[0_0_0_1px_rgba(0,0,0,0.1)]" loading="lazy" />
            <span class="grow" class:font-semibold={c.code === selectedCode}>{c.name}</span>
            <span class="text-xs opacity-60">{c.code}</span>
          </button>
        </li>
      {:else}
        <li class="px-3 py-2 text-sm opacity-60">{t("No countries found")}</li>
      {/each}
    </ul>
  {/if}
</div>
