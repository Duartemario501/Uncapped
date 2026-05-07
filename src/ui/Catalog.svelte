<script>
  /**
   * Catalog.svelte — Unified, Plex-style grid of all videos across all nodes.
   *
   * Props:
   *   store      — the catalogStore from catalog.js
   *   localFiles — array of { fingerprint, file, title, size, mime }
   *
   * Events:
   *   play — detail = CatalogEntry (with sources[])
   */

  import { createEventDispatcher } from 'svelte';
  import VideoCard from './VideoCard.svelte';

  export let store;
  export let localFiles = [];

  const dispatch = createEventDispatcher();

  let entries = [];
  $: localSet = new Set(localFiles.map((f) => f.fingerprint));

  const unsubscribe = store.subscribe((v) => { entries = v; });
  import { onDestroy } from 'svelte';
  onDestroy(unsubscribe);

  $: sorted = [...entries].sort((a, b) => a.title.localeCompare(b.title));

  function play(entry) {
    dispatch('play', entry);
  }
</script>

<section class="catalog">
  {#if sorted.length === 0}
    <div class="empty-state">
      <div class="empty-icon">📡</div>
      <p class="empty-title">No videos on the network yet</p>
      <p class="empty-sub">
        Share a local folder with <strong>📁 Share Folder</strong> to publish
        your videos, or wait for other nodes to appear.
      </p>
    </div>
  {:else}
    <div class="grid">
      {#each sorted as entry (entry.fingerprint)}
        <VideoCard
          {entry}
          isLocal={localSet.has(entry.fingerprint)}
          on:play={() => play(entry)}
        />
      {/each}
    </div>
  {/if}
</section>

<style>
  .catalog {
    flex: 1;
    padding: 1.5rem;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 1.25rem;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 4rem 1rem;
    text-align: center;
    color: #6b6b80;
  }

  .empty-icon {
    font-size: 3rem;
  }

  .empty-title {
    font-size: 1.1rem;
    font-weight: 600;
    color: #9292a8;
  }

  .empty-sub {
    font-size: 0.88rem;
    max-width: 380px;
    line-height: 1.5;
  }
</style>
