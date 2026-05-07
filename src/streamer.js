/**
 * streamer.js — Chunk-based video streaming over WebRTC DataChannels.
 *
 * Responsibilities:
 *   • Split a local File into 2 MB chunks and send them to a requesting peer.
 *   • Receive chunks from a remote peer and forward them to the player.
 *
 * Protocol (binary messages over DataChannel):
 *   Each message is a JSON-prefix-length-encoded packet followed by a binary
 *   payload.  The wire format is:
 *
 *     [ 4 bytes LE uint32 = JSON header length ]
 *     [ N bytes JSON header ]
 *     [ M bytes binary chunk data ]
 *
 *   Header fields:
 *     { type, fingerprint, chunkIndex, totalChunks, mime }
 *
 *   Control messages (no binary payload):
 *     { type: 'REQUEST', fingerprint, startChunk }
 *     { type: 'EOF',     fingerprint }
 */

import { node } from './node.js';

const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB

// ─── Encoding helpers ─────────────────────────────────────────────────────────

function encodePacket(header, chunkData) {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(header));
  const lenBuf    = new ArrayBuffer(4);
  new DataView(lenBuf).setUint32(0, jsonBytes.byteLength, true);

  if (!chunkData) {
    const out = new Uint8Array(4 + jsonBytes.byteLength);
    out.set(new Uint8Array(lenBuf), 0);
    out.set(jsonBytes, 4);
    return out;
  }

  const out = new Uint8Array(4 + jsonBytes.byteLength + chunkData.byteLength);
  out.set(new Uint8Array(lenBuf), 0);
  out.set(jsonBytes, 4);
  out.set(new Uint8Array(chunkData), 4 + jsonBytes.byteLength);
  return out;
}

function decodePacket(buffer) {
  const view    = new DataView(buffer);
  const jsonLen = view.getUint32(0, true);
  const jsonStr = new TextDecoder().decode(new Uint8Array(buffer, 4, jsonLen));
  const header  = JSON.parse(jsonStr);
  const body    = buffer.byteLength > 4 + jsonLen
    ? buffer.slice(4 + jsonLen)
    : null;
  return { header, body };
}

// ─── Streamer class ───────────────────────────────────────────────────────────

export class Streamer extends EventTarget {
  /**
   * Map of local files available to stream: fingerprint → File
   * @type {Map<string, File>}
   */
  #localFiles = new Map();

  constructor() {
    super();
    // Listen for incoming data from any peer.
    node.addEventListener('data', (e) => {
      this.#handleData(e.detail.peerID, e.detail.data);
    });
  }

  /**
   * Register a local file so it can be served to requesting peers.
   *
   * @param {string} fingerprint
   * @param {File}   file
   */
  addLocalFile(fingerprint, file) {
    this.#localFiles.set(fingerprint, file);
  }

  removeLocalFile(fingerprint) {
    this.#localFiles.delete(fingerprint);
  }

  /**
   * Request a video stream from a remote peer.
   *
   * @param {string} remotePeerID
   * @param {string} fingerprint
   * @param {number} startChunk   — resume from this chunk index (default 0)
   */
  requestStream(remotePeerID, fingerprint, startChunk = 0) {
    // Ensure connection exists.
    node.connect(remotePeerID);

    const tryRequest = () => {
      const packet = encodePacket({ type: 'REQUEST', fingerprint, startChunk });
      node.send(remotePeerID, packet);
    };

    // If already connected, send immediately; otherwise wait for connection.
    const peers = node.connectedPeers();
    if (peers.includes(remotePeerID)) {
      tryRequest();
    } else {
      const onConnect = (e) => {
        if (e.detail.peerID === remotePeerID) {
          node.removeEventListener('peer-connect', onConnect);
          tryRequest();
        }
      };
      node.addEventListener('peer-connect', onConnect);
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  async #handleData(fromPeerID, rawData) {
    let buffer;
    if (rawData instanceof ArrayBuffer) {
      buffer = rawData;
    } else if (rawData instanceof Uint8Array) {
      buffer = rawData.buffer.slice(rawData.byteOffset, rawData.byteOffset + rawData.byteLength);
    } else if (typeof rawData === 'string') {
      // Control message as plain JSON string (fallback).
      try {
        const msg = JSON.parse(rawData);
        if (msg.type === 'REQUEST') {
          await this.#serveFile(fromPeerID, msg.fingerprint, msg.startChunk ?? 0);
        }
      } catch { /* ignore */ }
      return;
    } else {
      return;
    }

    let decoded;
    try {
      decoded = decodePacket(buffer);
    } catch {
      return;
    }

    const { header, body } = decoded;

    switch (header.type) {
      case 'REQUEST':
        await this.#serveFile(fromPeerID, header.fingerprint, header.startChunk ?? 0);
        break;

      case 'CHUNK':
        /** Emit a 'chunk' event so the player can consume it. */
        this.dispatchEvent(new CustomEvent('chunk', {
          detail: {
            fingerprint: header.fingerprint,
            chunkIndex:  header.chunkIndex,
            totalChunks: header.totalChunks,
            mime:        header.mime,
            data:        body,
          },
        }));
        break;

      case 'EOF':
        this.dispatchEvent(new CustomEvent('eof', {
          detail: { fingerprint: header.fingerprint },
        }));
        break;

      default:
        break;
    }
  }

  async #serveFile(toPeerID, fingerprint, startChunk) {
    const file = this.#localFiles.get(fingerprint);
    if (!file) {
      console.warn('[streamer] requested file not found:', fingerprint);
      return;
    }

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    for (let i = startChunk; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end   = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = await file.slice(start, end).arrayBuffer();

      const packet = encodePacket(
        {
          type:        'CHUNK',
          fingerprint,
          chunkIndex:  i,
          totalChunks,
          mime:        file.type || 'video/mp4',
        },
        chunk,
      );

      // Throttle slightly to avoid overflowing the DataChannel buffer.
      node.send(toPeerID, packet);
      await new Promise((r) => setTimeout(r, 4));
    }

    // Signal end-of-file.
    node.send(toPeerID, encodePacket({ type: 'EOF', fingerprint }));
  }
}

/** Singleton streamer instance */
export const streamer = new Streamer();
