# Development

This document covers the local development workflow for Choir.

## Prerequisites

- Node.js.
- npm.
- Obsidian desktop for manual testing.

## Setup

```sh
npm install
```

## Commands

```sh
npm run typecheck
npm run build
npm run dev
npm run check
node --check main.js
```

`npm run dev` starts an esbuild watch process and writes `main.js` plus `styles.css`. Stop it with `Ctrl+C`.

`npm run check` runs the same verification path as CI: TypeScript, production build, a syntax check of the generated bundle, and a diff check that fails if `main.js` or `styles.css` are stale.

## Build outputs

The plugin source lives in:

- `src/main.ts`
- `src/styles.css`

The release assets are:

- `main.js`
- `manifest.json`
- `styles.css`

`main.js` and `styles.css` are generated, but they are committed because Obsidian and manual installers use them directly.

## Manual testing checklist

Before a release, test in Obsidian desktop:

- Choir opens from the ribbon icon and command palette.
- Clicking an MP3, FLAC, or M4A file opens the player.
- Search filters the library.
- Embedded cover art appears in lists and the mini player.
- Cover art recolors the player theme.
- Play, pause, seek, next, previous, shuffle, repeat, mute, and volume work.
- Queue rows play on click and can be moved or removed.
- Playlists can be created from the queue.
- Recently played tracks are recorded and can be saved as a playlist.
- Artists group by metadata.
- Settings persist after restart.
- Sidebar tab order persists after dragging.

## Public repo hygiene

Do not commit:

- `node_modules/`
- `data.json`
- `.hotreload`
- vault files
- screenshots that reveal private vault paths or personal files
- test audio files without redistribution rights
