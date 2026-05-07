<script>
  /**
   * VideoCard.svelte — Single card in the catalog grid.
   *
   * Props:
   *   entry   — CatalogEntry { fingerprint, title, size, mime, sources[], sourceCount }
   *   isLocal — whether the video is available on this local node
   *
   * Events:
   *   play — user clicked to play this video
   */

  import { createEventDispatcher } from 'svelte';

  export let entry;
  export let isLocal = false;

  const dispatch = createEventDispatcher();

  function formatSize(bytes) {
    if (!bytes) return '';
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    return `${(bytes / 1e6).toFixed(0)} MB`;
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="card" on:click={() => dispatch('play')} role="button" tabindex="0"
  on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && dispatch('play')}>

  <div class="thumb">
    <svg viewBox="0 0 64 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect width="64" height="48" rx="4" fill="#1e1e2e"/>
      <circle cx="32" cy="24" r="14" fill="#2a2a3a"/>
      <polygon points="27,17 43,24 27,31" fill="#7c3aed"/>
    </svg>
    {#if isLocal}
      <span class="badge local">Local</span>
    {/if}
  </div>

  <div class="info">
    <p class="title" title={entry.title}>{entry.title}</p>
    <div class="meta">
      <span class="sources" title="{entry.sourceCount} node(s) seeding">
        🌐 {entry.sourceCount} {entry.sourceCount === 1 ? 'source' : 'sources'}
      </span>
      {#if entry.size}
        <span class="size">{formatSize(entry.size)}</span>
      {/if}
    </div>
  </div>
</div>

<style>
  .card {
    background: #18181f;
    border: 1px solid #2a2a35;
    border-radius: 10px;
    overflow: hidden;
    cursor: pointer;
    transition: border-color 0.15s, transform 0.12s;
    user-select: none;
  }

  .card:hover {
    border-color: #7c3aed;
    transform: translateY(-2px);
  }

  .card:focus-visible {
    outline: 2px solid #7c3aed;
    outline-offset: 2px;
  }

  .thumb {
    position: relative;
    width: 100%;
  }

  .thumb svg {
    width: 100%;
    height: auto;
    display: block;
  }

  .badge {
    position: absolute;
    top: 6px;
    right: 6px;
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .badge.local {
    background: #7c3aed;
    color: #fff;
  }

  .info {
    padding: 0.6rem 0.75rem;
  }

  .title {
    font-size: 0.9rem;
    font-weight: 600;
    color: #e2e2e8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 0.3rem;
  }

  .meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
  }

  .sources {
    font-size: 0.75rem;
    color: #a78bfa;
  }

  .size {
    font-size: 0.72rem;
    color: #6b6b80;
  }
</style>
