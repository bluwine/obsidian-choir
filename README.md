# Choir

Choir is an Obsidian plugin that turns audio files in your vault into an offline, sidebar music player. It is built for local music libraries: search your vault, play embedded-cover audio files, build queues and playlists, browse artists, and keep a recently played list without sending anything outside Obsidian.

Choir is not affiliated with Spotify. "Spotify-like" describes the familiar music-player interaction model: cover art, queue controls, repeat, shuffle, playlists, and a compact now-playing player.

## Features

- Plays common vault audio files, including MP3, FLAC, M4A, AAC, WAV, OGG, Opus, WebM, AIFF, and ALAC.
- Opens the Choir sidebar when a supported audio file is opened from Obsidian.
- Searches audio files across the vault or configured music folders.
- Reads embedded metadata for title, artist, album, track number, and cover art.
- Uses embedded cover art to recolor the player theme.
- Groups tracks by artist and album when metadata is available.
- Maintains a queue with shuffle, repeat all, and repeat one.
- Creates playlists from the current queue or recently played list.
- Tracks recently played songs.
- Provides settings for library folders, click behavior, appearance, tab order, queue persistence, and history retention.

## Screens

- **Music**: searchable library of indexed audio files.
- **Artists**: metadata-based artist groups, sorted by artist and album.
- **Recent**: recently played tracks, with an option to save history as a playlist.
- **Queue**: current playback queue, with reorder and playlist export controls.
- **Lists**: saved playlists.

The order of these tabs can be changed in Choir settings.

## Installation

### From the Obsidian community plugin directory

Choir is prepared for community-plugin submission. After approval, install it from:

1. Obsidian Settings.
2. Community plugins.
3. Browse.
4. Search for `Choir`.
5. Install and enable it.

### Manual install

1. Download the release assets:
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. Create this folder in your vault:

   ```text
   .obsidian/plugins/choir/
   ```

3. Place the three files in that folder.
4. Restart Obsidian.
5. Enable Choir in Settings -> Community plugins.

## Usage

Open Choir from the ribbon music icon or the command palette command **Open Choir**.

To start playback, click a supported audio file in the file explorer or choose a track from the Choir library. By default, opening a file plays only that song. In settings, you can change this behavior to queue the whole containing folder.

Use the bottom player for playback controls:

- Play or pause.
- Skip forward or backward.
- Shuffle.
- Repeat off, repeat all, or repeat one.
- Seek within the song.
- Adjust or mute volume.

Rows are clickable. Track action buttons are for secondary actions such as adding to queue, opening menus, moving queue items, or deleting playlist entries.

## Settings

Choir settings include:

- **Music folders**: restrict scanning to specific vault folders.
- **Excluded folders**: ignore folders that contain audio you do not want in Choir.
- **Intercept audio file clicks**: choose whether supported audio files open in Choir automatically.
- **Audio file open behavior**: play only the clicked song or queue the clicked song's folder.
- **Volume, shuffle, repeat**: saved playback preferences.
- **Remember queue**: restore or discard the current queue between Obsidian restarts.
- **Recent history limit**: choose how many tracks are kept in Recently played.
- **Status bar now playing**: optionally show a compact status-bar item.
- **Color theme**: use cover art colors or Obsidian's accent color.
- **Cover color strength**: tune how strongly cover art recolors the interface.
- **Layout density**: comfortable or compact.
- **Row action buttons**: show secondary actions on hover or always.
- **Sidebar tab order**: drag Music, Artists, Recent, Queue, and Lists into the preferred order.
- **Track numbers and cover thumbnails**: show or hide list details.

## Privacy and data

Choir is an offline plugin.

- It does not send telemetry.
- It does not make network requests.
- It does not require an account.
- It reads audio files in your vault to extract playback sources, embedded metadata, and embedded cover art.
- It stores settings, playlists, queue state, and recent history in Obsidian plugin data for the current vault.

## Audio support notes

Choir uses the audio support available in Obsidian's runtime. Format support can vary by platform and operating system codec support. If a file appears in the library but does not play, the file's codec may not be supported by the current Obsidian/Electron environment.

## Development

Requirements:

- Node.js.
- npm.
- Obsidian desktop for manual testing.

Install dependencies:

```sh
npm install
```

Run type checks:

```sh
npm run typecheck
```

Build release assets:

```sh
npm run build
```

Watch during development:

```sh
npm run dev
```

Syntax-check the generated bundle:

```sh
node --check main.js
```

Release assets are intentionally checked in:

- `main.js`
- `manifest.json`
- `styles.css`

This lets users install the plugin manually and lets Obsidian download release assets from GitHub.

## Repository layout

```text
.
|-- src/
|   |-- main.ts
|   `-- styles.css
|-- build.mjs
|-- main.js
|-- manifest.json
|-- styles.css
|-- versions.json
|-- package.json
|-- package-lock.json
`-- docs/
```

## License

Choir is released under the MIT License. See [LICENSE](LICENSE).
