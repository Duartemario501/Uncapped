/**
 * node.js — Local P2P identity and WebRTC peer management.
 *
 * Responsibilities:
 *   • Generate (or restore) an Ed25519 keypair stored in localStorage.
 *   • Expose a stable PeerID (base64url-encoded public key).
 *   • Manage simple-peer connections: initiate and accept WebRTC sessions
 *     that are signalled through GunDB.
 *   • Emit 'stream-chunk' events so streamer.js can feed data into the player.
 */

import SimplePeer from 'simple-peer';

const STORAGE_KEY_PRIV = 'uncapped.privkey';
const STORAGE_KEY_PUB  = 'uncapped.pubkey';
const STORAGE_KEY_ID   = 'uncapped.peerid';

// ─── Key helpers ─────────────────────────────────────────────────────────────

function ab2b64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function b642ab(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

/**
 * Generate a new Ed25519 keypair and persist it in localStorage.
 * Falls back to a random UUID-based ID on browsers that don't support Ed25519
 * (pre-2023 engines).
 */
async function generateOrLoadIdentity() {
  const storedId  = localStorage.getItem(STORAGE_KEY_ID);
  const storedPub = localStorage.getItem(STORAGE_KEY_PUB);

  if (storedId && storedPub) {
    // Already initialised — restore the ID.
    return storedId;
  }

  try {
    const keypair = await crypto.subtle.generateKey(
      { name: 'Ed25519' },
      true,           // extractable
      ['sign', 'verify'],
    );

    const pubRaw  = await crypto.subtle.exportKey('raw', keypair.publicKey);
    const privJwk = await crypto.subtle.exportKey('jwk', keypair.privateKey);

    const peerID = ab2b64(pubRaw)
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');  // base64url

    localStorage.setItem(STORAGE_KEY_ID,   peerID);
    localStorage.setItem(STORAGE_KEY_PUB,  ab2b64(pubRaw));
    localStorage.setItem(STORAGE_KEY_PRIV, JSON.stringify(privJwk));

    return peerID;
  } catch {
    // Ed25519 not supported — fall back to random UUID.
    const fallback = crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
    localStorage.setItem(STORAGE_KEY_ID, fallback);
    return fallback;
  }
}

// ─── Node class ───────────────────────────────────────────────────────────────

export class Node extends EventTarget {
  /** @type {string} */
  peerID = '';

  /** @type {Map<string, SimplePeer.Instance>} active WebRTC connections keyed by remote peerID */
  #peers = new Map();

  /** @type {((signal: object, toPeerID: string) => void) | null} */
  #signalSend = null;

  /**
   * Initialise the node — resolves once the PeerID is ready.
   * Call this before anything else.
   */
  async init() {
    this.peerID = await generateOrLoadIdentity();
    return this;
  }

  /**
   * Register the function that GunDB should use to forward WebRTC signals.
   * catalog.js calls this after it sets up its own gun listener.
   *
   * @param {(signal: object, toPeerID: string) => void} fn
   */
  setSignalSender(fn) {
    this.#signalSend = fn;
  }

  /**
   * Called by catalog.js when a WebRTC signal arrives for this node from a remote peer.
   *
   * @param {string} fromPeerID
   * @param {object} signal
   */
  handleIncomingSignal(fromPeerID, signal) {
    if (this.#peers.has(fromPeerID)) {
      // Existing peer — just pass the signal through.
      this.#peers.get(fromPeerID).signal(signal);
      return;
    }

    // New peer signalling us — create a non-initiator peer.
    const peer = this.#createPeer(fromPeerID, false);
    peer.signal(signal);
  }

  /**
   * Initiate a WebRTC connection to a remote node.
   *
   * @param {string} remotePeerID
   * @returns {SimplePeer.Instance}
   */
  connect(remotePeerID) {
    if (this.#peers.has(remotePeerID)) {
      return this.#peers.get(remotePeerID);
    }
    return this.#createPeer(remotePeerID, true);
  }

  /**
   * Send a message to a connected peer.
   *
   * @param {string} remotePeerID
   * @param {string | Uint8Array | ArrayBuffer} data
   */
  send(remotePeerID, data) {
    const peer = this.#peers.get(remotePeerID);
    if (peer && peer.connected) {
      peer.send(data);
    }
  }

  /** @returns {string[]} list of currently connected peer IDs */
  connectedPeers() {
    return [...this.#peers.entries()]
      .filter(([, p]) => p.connected)
      .map(([id]) => id);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  #createPeer(remotePeerID, initiator) {
    const peer = new SimplePeer({
      initiator,
      trickle: true,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      },
    });

    this.#peers.set(remotePeerID, peer);

    peer.on('signal', (signal) => {
      this.#signalSend?.(signal, remotePeerID);
    });

    peer.on('connect', () => {
      this.dispatchEvent(new CustomEvent('peer-connect', { detail: { peerID: remotePeerID } }));
    });

    peer.on('data', (data) => {
      this.dispatchEvent(new CustomEvent('data', { detail: { peerID: remotePeerID, data } }));
    });

    peer.on('close', () => {
      this.#peers.delete(remotePeerID);
      this.dispatchEvent(new CustomEvent('peer-disconnect', { detail: { peerID: remotePeerID } }));
    });

    peer.on('error', (err) => {
      console.warn('[node] peer error', remotePeerID, err.message);
      this.#peers.delete(remotePeerID);
    });

    return peer;
  }
}

/** Singleton node instance */
export const node = new Node();
