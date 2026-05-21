# Release checklist

This checklist follows the public Obsidian plugin release flow.

## Before release

1. Update `manifest.json` version using semantic versioning.
2. Update `package.json` version to match `manifest.json`.
3. Update `versions.json` if the minimum supported Obsidian version changes.
4. Update `CHANGELOG.md`.
5. Run:

   ```sh
   npm install
   npm run check
   ```

6. Review the repository for private files:

   ```sh
   find . -maxdepth 3 -type f | sort
   rg -n "data.json|node_modules|\\.hotreload|PRIVATE_PATH|PRIVATE_VAULT"
   ```

7. Confirm these root files exist:

   - `README.md`
   - `LICENSE`
   - `manifest.json`
   - `main.js`
   - `styles.css`

## GitHub release

1. Commit the release.
2. Create a Git tag that exactly matches `manifest.json` version, for example `0.0.1`.
3. Create a GitHub release from that tag.
4. Upload release assets:

   - `main.js`
   - `manifest.json`
   - `styles.css`

## Obsidian community plugin submission

Submit the plugin to `obsidianmd/obsidian-releases` only for the first public version. The community plugin entry should use:

```json
{
  "id": "choir",
  "name": "Choir",
  "author": "bluwine",
  "description": "Spotify-like offline music player for MP3, FLAC, M4A, and other vault audio files.",
  "repo": "bluwine/obsidian-choir"
}
```

After the plugin is accepted, future updates are distributed through GitHub releases.
