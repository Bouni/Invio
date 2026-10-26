<script lang="ts">
  import { getContext } from "svelte";
  import { countryName, flagUrl, normalizeCountryCode } from "$lib/countries";

  // Renders the flag for an ISO alpha-2 code, optionally followed by the code
  // or the localized country name. Unknown codes render as plain text.
  let { code = "", label = "none", class: className = "" }: { code?: string; label?: "none" | "code" | "name"; class?: string } = $props();

  const getLoc = getContext("localization") as (() => any) | undefined;

  let normalized = $derived(normalizeCountryCode(code));
  let src = $derived(flagUrl(normalized));
  let name = $derived(countryName(normalized, getLoc?.()?.locale));
</script>

{#if normalized}
  <span class="inline-flex items-center gap-1.5 align-middle {className}">
    {#if src}
      <img {src} alt={label === "none" ? name : ""} title={name} class="h-3 w-4 shrink-0 rounded-[2px] object-cover shadow-[0_0_0_1px_rgba(0,0,0,0.1)]" loading="lazy" />
    {/if}
    {#if label === "code" || (label === "none" && !src)}
      <span>{normalized}</span>
    {:else if label === "name"}
      <span>{name}</span>
    {/if}
  </span>
{/if}
