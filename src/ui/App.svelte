<script>
  /**
   * App.svelte — Root application component.
   *
   * Manages:
   *   • Node + Catalog initialisation
   *   • File System Access API folder picker
   *   • Routing between the Catalog and Player views
   */

  import { onMount, onDestroy } from 'svelte';
  import { node }      from '../node.js';
  import { catalog, catalogStore, fingerprintFile } from '../catalog.js';
  import { streamer }  from '../streamer.js';
  import Catalog       from './Catalog.svelte';
  import Player        from './Player.svelte';

  // ── State ──────────────────────────────────────────────────────────────────
  let peerID       = '';
  let ready        = false;
  let localFiles   = [];   // { file, fingerprint, title, size, mime }
  let currentVideo = null; // { fingerprint, title, mime, sources: [] }
  let fsApiSupported = 'showDirectoryPicker' in window;

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  onMount(async () => {
    await node.init();
    peerID = node.peerID;

    catalog.init();
    ready = true;
  });

  onDestroy(() => {
    catalog.destroy();
  });

  // ── Folder picker ──────────────────────────────────────────────────────────
  async function pickFolder() {
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
      const found = [];

      for await (const entry of dirHandle.values()) {
        if (entry.kind !== 'file') continue;
        if (!/\.(mp4|webm|mkv|mov|avi|ogv|m4v)$/i.test(entry.name)) continue;

        const file = await entry.getFile();
        const fingerprint = await fingerprintFile(file);

        found.push({
          file,
          fingerprint,
          title: entry.name.replace(/\.[^.]+$/, ''),
          size:  file.size,
          mime:  file.type || guessMime(entry.name),
        });

        streamer.addLocalFile(fingerprint, file);
      }

      localFiles = found;

      catalog.publishLocalVideos(
        found.map(({ fingerprint, title, size, mime }) => ({
          fingerprint, title, size, mime,
        })),
      );
    } catch (e) {
      if (e.name !== 'AbortError') {
        alert(`Could not open folder: ${e.message}`);
      }
    }
  }

  function guessMime(name) {
    if (/\.webm$/i.test(name)) return 'video/webm';
    if (/\.(mkv)$/i.test(name)) return 'video/x-matroska';
    if (/\.(ogv|ogg)$/i.test(name)) return 'video/ogg';
    return 'video/mp4';
  }

  // ── Navigation ─────────────────────────────────────────────────────────────
  function openVideo(entry) {
    currentVideo = entry;
  }

  function closePlayer() {
    currentVideo = null;
  }
</script>

<main>
  <header class="app-header">
    <div class="brand">
      <svg class="logo" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="16" cy="16" r="16" fill="#7c3aed"/>
        <polygon points="12,9 24,16 12,23" fill="white"/>
      </svg>
      <span class="brand-name">Uncapped</span>
    </div>

    <div class="header-actions">
      {#if fsApiSupported}
        <button class="btn-primary" on:click={pickFolder} disabled={!ready}>
          📁 Share Folder
        </button>
      {:else}
        <span class="hint">File System API not supported in this browser.</span>
      {/if}

      {#if peerID}
        <span class="peer-id" title="Your Node ID"
          >🔑 {peerID.slice(0, 10)}…</span
        >
      {/if}
    </div>
  </header>

  {#if currentVideo}
    <Player entry={currentVideo} localFiles={localFiles} on:close={closePlayer} />
  {:else if ready}
    <Catalog store={catalogStore} localFiles={localFiles} on:play={(e) => openVideo(e.detail)} />
  {:else}
    <div class="loading">Connecting to the P2P network…</div>
  {/if}
</main>

<style>
  :global(*) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    background: #0f0f13;
    color: #e2e2e8;
    font-family: 'Segoe UI', system-ui, sans-serif;
    min-height: 100vh;
  }

  main {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1.5rem;
    background: #18181f;
    border-bottom: 1px solid #2a2a35;
    gap: 1rem;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .logo {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
  }

  .brand-name {
    font-size: 1.25rem;
    font-weight: 700;
    color: #a78bfa;
    letter-spacing: -0.02em;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .btn-primary {
    background: #7c3aed;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 0.45rem 1rem;
    font-size: 0.9rem;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-primary:hover:not(:disabled) {
    background: #6d28d9;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .peer-id {
    font-size: 0.75rem;
    color: #6b6b80;
    font-family: monospace;
  }

  .hint {
    font-size: 0.8rem;
    color: #6b6b80;
  }

  .loading {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #6b6b80;
    font-size: 1.1rem;
  }
</style>
