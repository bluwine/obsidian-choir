# Changelog

## Unreleased

- Debounced plugin-data saves to avoid repeated immediate writes during rapid UI changes.
- Kept queued playback index stable when a deleted audio file appears before the current track.
- Invalidated embedded metadata and cover-art caches when vault audio files are modified.
- Copied `src/styles.css` during the development watcher when CSS changes.

## 0.0.1

Initial public release.

- Added sidebar offline music player for vault audio files.
- Added library scan and search.
- Added embedded metadata and cover art extraction.
- Added cover-color theming.
- Added queue, shuffle, repeat, and volume controls.
- Added playlists and playlist creation from queue or recently played tracks.
- Added Artists, Recent, Queue, and Lists tabs.
- Added draggable sidebar tab order in settings.
- Added library folder filters and appearance settings.
