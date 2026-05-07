/**
 * player.js — MediaSource Extensions (MSE) video player.
 *
 * Feeds incoming 2 MB chunks from the streamer into a SourceBuffer so the
 * browser can play the video progressively without buffering the whole file.
 *
 * Usage:
 *   const player = new Player(videoElement, 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"');
 *   await player.open();
 *   player.appendChunk(arrayBuffer);
 *   player.endOfStream();
 */

export class Player {
  /** @type {HTMLVideoElement} */
  #video = null;

  /** @type {MediaSource} */
  #mediaSource = null;

  /** @type {SourceBuffer | null} */
  #sourceBuffer = null;

  /** @type {string} */
  #mime = '';

  /** @type {ArrayBuffer[]} queue of chunks waiting for the SourceBuffer to be ready */
  #queue = [];

  /** @type {boolean} */
  #open = false;

  /** @type {boolean} */
  #streamEnded = false;

  /**
   * @param {HTMLVideoElement} videoEl
   * @param {string} mime  e.g. 'video/mp4; codecs="avc1.42E01E"'
   */
  constructor(videoEl, mime) {
    this.#video = videoEl;
    this.#mime  = mime || 'video/mp4';
  }

  /**
   * Open the MediaSource and attach it to the video element.
   * Resolves once the SourceBuffer is ready.
   */
  open() {
    return new Promise((resolve, reject) => {
      if (!('MediaSource' in window)) {
        reject(new Error('MediaSource Extensions not supported in this browser.'));
        return;
      }

      // Use a codec-only mime for checking support, with a fallback.
      const mimeForCheck = this.#mime;
      const supported = MediaSource.isTypeSupported(mimeForCheck)
        || MediaSource.isTypeSupported('video/mp4');

      if (!supported) {
        reject(new Error(`MIME type not supported: ${this.#mime}`));
        return;
      }

      const ms = new MediaSource();
      this.#mediaSource = ms;

      const objectURL = URL.createObjectURL(ms);
      this.#video.src = objectURL;

      ms.addEventListener('sourceopen', () => {
        URL.revokeObjectURL(objectURL);
        try {
          // Prefer the exact mime; fall back to bare video/mp4.
          const mime = MediaSource.isTypeSupported(this.#mime)
            ? this.#mime
            : 'video/mp4';
          const sb = ms.addSourceBuffer(mime);
          this.#sourceBuffer = sb;
          this.#open = true;

          sb.addEventListener('updateend', () => this.#flushQueue());

          resolve();
        } catch (e) {
          reject(e);
        }
      }, { once: true });

      ms.addEventListener('error', reject, { once: true });
    });
  }

  /**
   * Append a chunk (ArrayBuffer) to the SourceBuffer.
   * If the buffer isn't ready yet, the chunk is queued.
   *
   * @param {ArrayBuffer} buffer
   */
  appendChunk(buffer) {
    this.#queue.push(buffer);
    this.#flushQueue();
  }

  /**
   * Signal that no more chunks are coming — calls MediaSource.endOfStream().
   */
  endOfStream() {
    this.#streamEnded = true;
    this.#flushQueue();
  }

  /**
   * Destroy the player and release resources.
   */
  destroy() {
    this.#open = false;
    try {
      if (
        this.#mediaSource &&
        this.#mediaSource.readyState === 'open'
      ) {
        this.#mediaSource.endOfStream();
      }
    } catch { /* ignore */ }
    this.#video.src = '';
    this.#sourceBuffer = null;
    this.#mediaSource  = null;
    this.#queue = [];
  }

  // ── Private ────────────────────────────────────────────────────────────────

  #flushQueue() {
    if (!this.#open) return;
    const sb = this.#sourceBuffer;
    if (!sb || sb.updating) return;

    if (this.#queue.length > 0) {
      const next = this.#queue.shift();
      try {
        sb.appendBuffer(next);
      } catch (e) {
        console.warn('[player] appendBuffer error:', e.message);
      }
      return;
    }

    // Queue drained — finalise if stream ended.
    if (this.#streamEnded) {
      try {
        if (this.#mediaSource.readyState === 'open') {
          this.#mediaSource.endOfStream();
        }
      } catch { /* ignore */ }
    }
  }
}
