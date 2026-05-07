<script>
  /**
   * Player.svelte — Video player component.
   *
   * Handles both cases:
   *   1. The video is available locally → create an object URL and play directly.
   *   2. The video is only on remote peers → request via WebRTC DataChannel
   *      and feed chunks through MediaSource Extensions.
   *
   * Props:
   *   entry      — CatalogEntry { fingerprint, title, mime, sources[] }
   *   localFiles — array of { fingerprint, file, title, size, mime }
   *
   * Events:
   *   close — user clicked the back button
   */

  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { streamer } from '../streamer.js';
  import { Player as MSEPlayer } from '../player.js';

  export let entry;
  export let localFiles = [];

  const dispatch = createEventDispatcher();

  let videoEl;
  let msePlayer = null;
  let status    = 'Preparing…';
  let progress  = 0;   // 0–100
  let error     = '';

  $: localFile = localFiles.find((f) => f.fingerprint === entry.fingerprint);

  onMount(async () => {
    if (localFile) {
      // Fast path: play directly from the local File object.
      const url = URL.createObjectURL(localFile.file);
      videoEl.src = url;
      videoEl.play().catch(() => {});
      status = 'Playing (local)';
    } else {
      // Remote path: stream via WebRTC.
      await streamRemote();
    }
  });

  onDestroy(() => {
    if (msePlayer) msePlayer.destroy();
    if (localFile && videoEl?.src?.startsWith('blob:')) {
      URL.revokeObjectURL(videoEl.src);
    }
    // Remove chunk/eof listeners.
    streamer.removeEventListener('chunk', onChunk);
    streamer.removeEventListener('eof',   onEof);
  });

  async function streamRemote() {
    // Pick a source peer — prefer any that is online.
    const source = entry.sources?.[0];
    if (!source) {
      error  = 'No sources available for this video.';
      status = 'Error';
      return;
    }

    const mime = entry.mime || 'video/mp4';
    msePlayer  = new MSEPlayer(videoEl, mime);

    try {
      await msePlayer.open();
    } catch (e) {
      error  = `MediaSource error: ${e.message}`;
      status = 'Error';
      return;
    }

    status = `Connecting to ${source.peerID.slice(0, 8)}…`;

    streamer.addEventListener('chunk', onChunk);
    streamer.addEventListener('eof',   onEof);

    streamer.requestStream(source.peerID, entry.fingerprint);
  }

  let chunksReceived = 0;
  let totalChunks    = 0;

  function onChunk(e) {
    const { fingerprint, chunkIndex, totalChunks: tot, data } = e.detail;
    if (fingerprint !== entry.fingerprint) return;

    chunksReceived = chunkIndex + 1;
    totalChunks    = tot;
    progress       = Math.round((chunksReceived / tot) * 100);
    status         = `Buffering… ${progress}%`;

    msePlayer?.appendChunk(data);

    // Start playing once we have a little data buffered.
    if (chunkIndex === 0) {
      videoEl.play().catch(() => {});
      status = 'Playing (remote)';
    }
  }

  function onEof(e) {
    if (e.detail.fingerprint !== entry.fingerprint) return;
    msePlayer?.endOfStream();
    progress = 100;
    status   = 'Stream complete';
  }
</script>

<div class="player-view">
  <div class="player-bar">
    <button class="back-btn" on:click={() => dispatch('close')}>
      ← Back
    </button>
    <span class="player-title">{entry.title}</span>
    <span class="player-status">{status}</span>
  </div>

  {#if error}
    <div class="error-box">⚠️ {error}</div>
  {/if}

  <!-- svelte-ignore a11y-media-has-caption -->
  <video
    bind:this={videoEl}
    class="video-el"
    controls
    autoplay
  ></video>

  {#if !localFile && progress > 0 && progress < 100}
    <div class="progress-bar" role="progressbar" aria-valuenow={progress} aria-valuemin="0" aria-valuemax="100">
      <div class="progress-fill" style="width: {progress}%"></div>
    </div>
  {/if}
</div>

<style>
  .player-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: #000;
  }

  .player-bar {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.6rem 1rem;
    background: #18181f;
    border-bottom: 1px solid #2a2a35;
  }

  .back-btn {
    background: transparent;
    color: #a78bfa;
    border: 1px solid #7c3aed;
    border-radius: 5px;
    padding: 0.3rem 0.75rem;
    cursor: pointer;
    font-size: 0.85rem;
    transition: background 0.15s;
  }

  .back-btn:hover {
    background: #7c3aed22;
  }

  .player-title {
    font-weight: 600;
    font-size: 0.95rem;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #e2e2e8;
  }

  .player-status {
    font-size: 0.75rem;
    color: #6b6b80;
    white-space: nowrap;
  }

  .error-box {
    background: #3d1515;
    color: #f87171;
    padding: 0.75rem 1rem;
    font-size: 0.9rem;
  }

  .video-el {
    flex: 1;
    width: 100%;
    background: #000;
    min-height: 0;
  }

  .progress-bar {
    height: 4px;
    background: #2a2a35;
  }

  .progress-fill {
    height: 100%;
    background: #7c3aed;
    transition: width 0.3s;
  }
</style>
