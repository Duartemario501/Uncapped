# Uncapped

Uncapped es una red de streaming descentralizada donde cada usuario es un nodo. Sin servidores centrales, sin censura, sin intermediarios. Comparte una carpeta, conéctate a la red y reproduce contenido de todos los nodos al mismo tiempo — más rápido cuanto más crece la comunidad.

## Features

- **Decentralized catalog** — each browser publishes its videos to a shared GunDB index (no central server).
- **P2P streaming** — video chunks (2 MB) are transferred directly between browsers via WebRTC DataChannels (powered by [simple-peer](https://github.com/feross/simple-peer)).
- **File System Access API** — share a local folder of videos with one click; no upload required.
- **SHA-256 deduplication** — the first 10 MB of each file is fingerprinted so the same video from different nodes is counted as one entry.
- **Node identity** — each browser generates an Ed25519 keypair stored in `localStorage` as its permanent PeerID.
- **Heartbeat / presence** — nodes broadcast a heartbeat every 30 s via GunDB; peers not seen for 60 s are marked offline.
- **Plex-style UI** — unified catalog grid showing source count per title, built with Svelte.

## Tech Stack

| Concern | Library |
|---|---|
| UI | [Svelte](https://svelte.dev) + [Vite](https://vitejs.dev) |
| Distributed state | [GunDB](https://gun.eco) (public relays) |
| WebRTC | [simple-peer](https://github.com/feross/simple-peer) |
| STUN | Google public STUN servers |
| Identity | Web Crypto API (Ed25519) |

Zero backend, zero database, zero auth server.

## Project Structure

```
src/
  node.js       — P2P identity (Ed25519) and WebRTC peer management
  catalog.js    — GunDB distributed catalog (publish + subscribe + heartbeat)
  streamer.js   — 2 MB chunk streaming over WebRTC DataChannels
  player.js     — MediaSource Extensions (MSE) player
  ui/
    App.svelte      — Root component + folder picker
    Catalog.svelte  — Plex-style catalog grid
    VideoCard.svelte — Individual video card
    Player.svelte   — Video player (local & remote streaming)
  main.js       — Svelte mount point
```

## Quick Start (local dev)

```bash
npm install
npm run dev
```

Open `http://localhost:5173`, click **Share Folder**, pick a folder containing `.mp4` / `.webm` files, and they will appear in the catalog. Open the same URL in another browser tab or on another machine — videos shared by either node will appear in both.

## Building for GitHub Pages

```bash
GITHUB_PAGES=true npm run build
# dist/ is ready to deploy
```

A GitHub Actions workflow (`.github/workflows/deploy.yml`) automatically builds and deploys to GitHub Pages on every push to `main`.

## License

[AGPL-3.0](LICENSE)

