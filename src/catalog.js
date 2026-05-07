/**
 * catalog.js — GunDB distributed catalog.
 *
 * Responsibilities:
 *   • Connect to public GunDB relays.
 *   • Publish the local node's video list and heartbeat.
 *   • Subscribe to the global index and merge it into a reactive store.
 *   • Forward WebRTC signals between peers via Gun's graph.
 *   • Expose helper to compute SHA-256 fingerprints for video deduplication.
 */

import Gun from 'gun/gun';
import { node } from './node.js';

// ─── Configuration ────────────────────────────────────────────────────────────

/** Free public GunDB relay peers */
const GUN_PEERS = [
  'https://gun-manhattan.herokuapp.com/gun',
  'https://peer.wallie.io/gun',
];

const HEARTBEAT_INTERVAL_MS = 30_000;  // 30 s
const OFFLINE_THRESHOLD_MS  = 60_000;  // 60 s

// ─── SHA-256 fingerprint (first 10 MB) ────────────────────────────────────────

/**
 * Compute a hex SHA-256 digest of the first 10 MB of a File.
 *
 * @param {File} file
 * @returns {Promise<string>} hex string
 */
export async function fingerprintFile(file) {
  const SAMPLE = 10 * 1024 * 1024; // 10 MB
  const slice  = file.slice(0, Math.min(SAMPLE, file.size));
  const buf    = await slice.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Catalog store ────────────────────────────────────────────────────────────

/**
 * In-memory catalog: Map<fingerprint, CatalogEntry>
 *
 * CatalogEntry = {
 *   fingerprint: string,
 *   title:       string,
 *   size:        number,
 *   mime:        string,
 *   sources:     Map<peerID, { peerID, seenAt }>
 * }
 *
 * @type {Map<string, object>}
 */
let catalogMap = new Map();

/** Svelte store subscribers */
const subscribers = new Set();

function notifySubscribers() {
  const snapshot = catalogSnapshot();
  for (const fn of subscribers) fn(snapshot);
}

/**
 * A minimal Svelte-compatible readable store backed by the in-memory catalog.
 */
export const catalogStore = {
  subscribe(fn) {
    subscribers.add(fn);
    fn(catalogSnapshot());           // immediate call with current value
    return () => subscribers.delete(fn);
  },
};

/**
 * Return a plain array snapshot of the catalog (stable across calls when
 * data hasn't changed).
 */
function catalogSnapshot() {
  return [...catalogMap.values()].map((e) => ({
    ...e,
    sources: [...e.sources.values()],
    sourceCount: e.sources.size,
  }));
}

// ─── Catalog updates ─────────────────────────────────────────────────────────

function upsertSource(fingerprint, meta, peerID) {
  if (!catalogMap.has(fingerprint)) {
    catalogMap.set(fingerprint, {
      fingerprint,
      title:   meta.title,
      size:    meta.size,
      mime:    meta.mime,
      sources: new Map(),
    });
  }
  const entry = catalogMap.get(fingerprint);
  // Always update title/size from the freshest data.
  entry.title = meta.title;
  entry.size  = meta.size;
  entry.mime  = meta.mime;
  entry.sources.set(peerID, { peerID, seenAt: Date.now() });
  notifySubscribers();
}

/** Remove sources that haven't sent a heartbeat within OFFLINE_THRESHOLD_MS. */
function pruneOfflineSources() {
  const now = Date.now();
  let changed = false;
  for (const entry of catalogMap.values()) {
    for (const [pid, src] of entry.sources) {
      if (now - src.seenAt > OFFLINE_THRESHOLD_MS) {
        entry.sources.delete(pid);
        changed = true;
      }
    }
  }
  // Remove entries with no remaining sources.
  for (const [fp, entry] of catalogMap) {
    if (entry.sources.size === 0) {
      catalogMap.delete(fp);
      changed = true;
    }
  }
  if (changed) notifySubscribers();
}

// ─── Catalog class ────────────────────────────────────────────────────────────

export class Catalog {
  /** @type {ReturnType<typeof Gun>} */
  #gun = null;

  /** @type {object[]} local video entries { fingerprint, title, size, mime } */
  #localVideos = [];

  /** @type {ReturnType<typeof setInterval>} */
  #heartbeatTimer = null;
  #pruneTimer     = null;

  /**
   * Initialise GunDB and start listening to the global catalog.
   * Must be called after node.init().
   */
  init() {
    this.#gun = Gun({ peers: GUN_PEERS, localStorage: false });

    this.#listenCatalog();
    this.#listenSignals();

    // Register the signal-sender with the node so it can send WebRTC offers.
    node.setSignalSender((signal, toPeerID) => {
      this.#sendSignal(signal, toPeerID);
    });

    // Start periodic pruning of offline sources.
    this.#pruneTimer = setInterval(pruneOfflineSources, 15_000);

    return this;
  }

  /** Publish the local video list and start heartbeating. */
  publishLocalVideos(videos) {
    this.#localVideos = videos;
    this.#publishHeartbeat();

    if (!this.#heartbeatTimer) {
      this.#heartbeatTimer = setInterval(
        () => this.#publishHeartbeat(),
        HEARTBEAT_INTERVAL_MS,
      );
    }
  }

  /** Remove a local video from the published list. */
  unpublishVideo(fingerprint) {
    this.#localVideos = this.#localVideos.filter(
      (v) => v.fingerprint !== fingerprint,
    );
    this.#publishHeartbeat();
  }

  destroy() {
    clearInterval(this.#heartbeatTimer);
    clearInterval(this.#pruneTimer);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  #publishHeartbeat() {
    if (!this.#gun || !node.peerID) return;

    const peerNode = this.#gun.get('uncapped/nodes').get(node.peerID);

    peerNode.put({
      peerID:    node.peerID,
      seenAt:    Date.now(),
      videoCount: this.#localVideos.length,
    });

    // Publish each video under its fingerprint.
    for (const v of this.#localVideos) {
      this.#gun
        .get('uncapped/catalog')
        .get(v.fingerprint)
        .put({
          fingerprint: v.fingerprint,
          title:       v.title,
          size:        v.size,
          mime:        v.mime,
          peerID:      node.peerID,
          seenAt:      Date.now(),
        });
    }
  }

  #listenCatalog() {
    this.#gun
      .get('uncapped/catalog')
      .map()
      .on((data, fingerprint) => {
        if (!data || !data.peerID || !data.title) return;
        upsertSource(fingerprint, data, data.peerID);
      });
  }

  #listenSignals() {
    if (!node.peerID) return;

    this.#gun
      .get('uncapped/signals')
      .get(node.peerID)
      .map()
      .on((data) => {
        if (!data || !data.from || !data.signal) return;
        try {
          const signal = typeof data.signal === 'string'
            ? JSON.parse(data.signal)
            : data.signal;
          node.handleIncomingSignal(data.from, signal);
        } catch (e) {
          console.warn('[catalog] bad signal', e);
        }
      });
  }

  #sendSignal(signal, toPeerID) {
    const key = `${node.peerID}_${Date.now()}`;
    this.#gun
      .get('uncapped/signals')
      .get(toPeerID)
      .get(key)
      .put({
        from:   node.peerID,
        signal: JSON.stringify(signal),
      });
  }
}

/** Singleton catalog instance */
export const catalog = new Catalog();
