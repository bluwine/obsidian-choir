import {
  App,
  FileView,
  ItemView,
  Menu,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TAbstractFile,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";

const VIEW_TYPE_CHOIR = "choir-player";
const VIEW_TYPE_CHOIR_AUDIO_FILE = "choir-audio-file";

const AUDIO_EXTENSIONS = [
  "mp3",
  "flac",
  "m4a",
  "aac",
  "wav",
  "ogg",
  "oga",
  "opus",
  "webm",
  "aif",
  "aiff",
  "alac",
] as const;

const AUDIO_EXTENSION_SET = new Set<string>(AUDIO_EXTENSIONS);
const DEFAULT_VOLUME = 0.85;
const DEFAULT_RECENT_LIMIT = 100;
const MIN_RECENT_LIMIT = 20;
const MAX_RECENT_LIMIT = 500;
const MAX_METADATA_READS = 3;
const MAX_ARTWORK_READS = 2;

type RepeatMode = "off" | "all" | "one";
type ChoirTab = "library" | "artists" | "recent" | "queue" | "playlists";
type BroadcastKind = "all" | "content" | "playback" | "progress";
type ThemeMode = "cover" | "obsidian";
type DensityMode = "comfortable" | "compact";
type RowActionVisibility = "hover" | "always";
type AudioFileOpenMode = "single" | "folder";

const DEFAULT_TAB_ORDER: ChoirTab[] = ["library", "artists", "recent", "queue", "playlists"];
const TAB_CONFIG: Record<ChoirTab, { label: string; icon: string }> = {
  library: { label: "Music", icon: "library" },
  artists: { label: "Artists", icon: "users" },
  recent: { label: "Recent", icon: "history" },
  queue: { label: "Queue", icon: "list-music" },
  playlists: { label: "Lists", icon: "list" },
};

interface ChoirPlaylist {
  id: string;
  name: string;
  trackPaths: string[];
  createdAt: number;
  updatedAt: number;
}

interface RecentlyPlayedTrack {
  path: string;
  playedAt: number;
}

interface ChoirData {
  playlists: ChoirPlaylist[];
  queue: string[];
  currentIndex: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
  volume: number;
  recentlyPlayed: RecentlyPlayedTrack[];
  settings: ChoirSettings;
}

interface ChoirSettings {
  musicFolders: string[];
  excludedFolders: string[];
  interceptAudioClicks: boolean;
  audioFileOpenMode: AudioFileOpenMode;
  rememberQueue: boolean;
  recentLimit: number;
  themeMode: ThemeMode;
  themeIntensity: number;
  density: DensityMode;
  rowActions: RowActionVisibility;
  showTrackNumbers: boolean;
  showCovers: boolean;
  floatingPanel: boolean;
  tabOrder: ChoirTab[];
  showStatusBar: boolean;
}

interface TrackDisplay {
  title: string;
  subtitle: string;
  path: string;
  missing: boolean;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface ArtworkPalette {
  background: RgbColor;
  accent: RgbColor;
  muted: RgbColor;
}

interface ArtworkData {
  objectUrl: string;
  mimeType: string;
  palette: ArtworkPalette;
}

type ArtworkCacheStatus = "loading" | "ready" | "missing";

interface ArtworkCacheEntry {
  mtime: number;
  size: number;
  status: ArtworkCacheStatus;
  artwork?: ArtworkData;
  promise?: Promise<void>;
}

interface TrackMetadata {
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  genre?: string;
  year?: string;
  trackNumber?: string;
}

type MetadataCacheStatus = "loading" | "ready" | "missing";

interface MetadataCacheEntry {
  mtime: number;
  size: number;
  status: MetadataCacheStatus;
  metadata?: TrackMetadata;
  promise?: Promise<void>;
}

interface ArtistGroup {
  artist: string;
  paths: string[];
  albums: string[];
}

type ByteArray = Uint8Array<ArrayBufferLike>;

interface EmbeddedPicture {
  mimeType: string;
  data: ByteArray;
}

const DEFAULT_DATA: ChoirData = {
  playlists: [],
  queue: [],
  currentIndex: -1,
  repeatMode: "off",
  shuffle: false,
  volume: DEFAULT_VOLUME,
  recentlyPlayed: [],
  settings: {
    musicFolders: [],
    excludedFolders: [],
    interceptAudioClicks: true,
    audioFileOpenMode: "single",
    rememberQueue: true,
    recentLimit: DEFAULT_RECENT_LIMIT,
    themeMode: "cover",
    themeIntensity: 0.9,
    density: "comfortable",
    rowActions: "hover",
    showTrackNumbers: true,
    showCovers: true,
    floatingPanel: false,
    tabOrder: DEFAULT_TAB_ORDER,
    showStatusBar: false,
  },
};

const DEFAULT_PALETTE: ArtworkPalette = {
  background: { r: 18, g: 18, b: 18 },
  accent: { r: 30, g: 215, b: 96 },
  muted: { r: 88, g: 96, b: 90 },
};

function isRepeatMode(value: unknown): value is RepeatMode {
  return value === "off" || value === "all" || value === "one";
}

function isChoirTab(value: unknown): value is ChoirTab {
  return value === "library" || value === "artists" || value === "recent" || value === "queue" || value === "playlists";
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "cover" || value === "obsidian";
}

function isDensityMode(value: unknown): value is DensityMode {
  return value === "comfortable" || value === "compact";
}

function isRowActionVisibility(value: unknown): value is RowActionVisibility {
  return value === "hover" || value === "always";
}

function isAudioFileOpenMode(value: unknown): value is AudioFileOpenMode {
  return value === "single" || value === "folder";
}

function isAudioPath(path: string): boolean {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_EXTENSION_SET.has(extension);
}

function isAudioFile(file: TFile): boolean {
  return AUDIO_EXTENSION_SET.has(file.extension.toLowerCase());
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeSearch(value: string): string[] {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function basenameFromPath(path: string): string {
  const filename = path.split("/").pop() ?? path;
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

function parentPath(file: TFile): string {
  const parent = file.parent?.path;
  return parent && parent !== "/" ? parent : "Vault";
}

function trackDisplayForFile(file: TFile, metadata: TrackMetadata | null): TrackDisplay {
  const artist = metadata?.artist ?? metadata?.albumArtist;
  const subtitleParts = [
    artist,
    metadata?.album,
    `${parentPath(file)} - ${file.extension.toUpperCase()}`,
  ].filter((part): part is string => Boolean(part));

  return {
    title: metadata?.title ?? file.basename,
    subtitle: subtitleParts.join(" - "),
    path: file.path,
    missing: false,
  };
}

function trackDisplayForMissingPath(path: string): TrackDisplay {
  return {
    title: basenameFromPath(path),
    subtitle: "Missing from vault",
    path,
    missing: true,
  };
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = `${total % 60}`.padStart(2, "0");
  return `${minutes}:${rest}`;
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function parseTrackSortNumber(value: string | undefined): number {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function sanitizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeFolderPath(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function sanitizeFolderList(value: unknown): string[] {
  const raw = typeof value === "string"
    ? value.split(/[\n,]/)
    : sanitizeStringArray(value);
  const seen = new Set<string>();
  const folders: string[] = [];

  for (const item of raw) {
    const folder = normalizeFolderPath(item);
    if (!folder || seen.has(folder.toLowerCase())) continue;
    seen.add(folder.toLowerCase());
    folders.push(folder);
  }

  return folders;
}

function normalizeTabOrder(value: unknown): ChoirTab[] {
  const order = Array.isArray(value) ? value.filter(isChoirTab) : [];
  const seen = new Set<ChoirTab>();
  const normalized: ChoirTab[] = [];

  for (const tab of order) {
    if (seen.has(tab)) continue;
    seen.add(tab);
    normalized.push(tab);
  }

  for (const tab of DEFAULT_TAB_ORDER) {
    if (seen.has(tab)) continue;
    normalized.push(tab);
  }

  return normalized;
}

function moveTabInOrder(order: ChoirTab[], source: ChoirTab, target: ChoirTab, placeAfter: boolean): ChoirTab[] {
  const withoutSource = normalizeTabOrder(order).filter((tab) => tab !== source);
  const targetIndex = withoutSource.indexOf(target);
  if (targetIndex === -1) return normalizeTabOrder(order);

  withoutSource.splice(targetIndex + (placeAfter ? 1 : 0), 0, source);
  return normalizeTabOrder(withoutSource);
}

function sanitizeRecent(value: unknown): RecentlyPlayedTrack[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): RecentlyPlayedTrack[] => {
    if (typeof item === "string" && isAudioPath(item)) {
      return [{ path: item, playedAt: Date.now() }];
    }
    if (typeof item !== "object" || item === null) return [];
    const candidate = item as Partial<RecentlyPlayedTrack>;
    if (typeof candidate.path !== "string" || !isAudioPath(candidate.path)) return [];
    return [{
      path: candidate.path,
      playedAt: typeof candidate.playedAt === "number" ? candidate.playedAt : Date.now(),
    }];
  });
}

function bytesToArrayBuffer(bytes: ByteArray): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function normalizeSettings(value: unknown): ChoirSettings {
  const raw = typeof value === "object" && value !== null ? value as Partial<ChoirSettings> : {};

  return {
    musicFolders: sanitizeFolderList(raw.musicFolders),
    excludedFolders: sanitizeFolderList(raw.excludedFolders),
    interceptAudioClicks: raw.interceptAudioClicks !== false,
    audioFileOpenMode: isAudioFileOpenMode(raw.audioFileOpenMode) ? raw.audioFileOpenMode : DEFAULT_DATA.settings.audioFileOpenMode,
    rememberQueue: raw.rememberQueue !== false,
    recentLimit: clamp(
      typeof raw.recentLimit === "number" ? Math.floor(raw.recentLimit) : DEFAULT_RECENT_LIMIT,
      MIN_RECENT_LIMIT,
      MAX_RECENT_LIMIT,
    ),
    themeMode: isThemeMode(raw.themeMode) ? raw.themeMode : DEFAULT_DATA.settings.themeMode,
    themeIntensity: clamp(typeof raw.themeIntensity === "number" ? raw.themeIntensity : DEFAULT_DATA.settings.themeIntensity, 0, 1),
    density: isDensityMode(raw.density) ? raw.density : DEFAULT_DATA.settings.density,
    rowActions: isRowActionVisibility(raw.rowActions) ? raw.rowActions : DEFAULT_DATA.settings.rowActions,
    showTrackNumbers: raw.showTrackNumbers !== false,
    showCovers: raw.showCovers !== false,
    floatingPanel: false,
    tabOrder: normalizeTabOrder(raw.tabOrder),
    showStatusBar: raw.showStatusBar === true,
  };
}

function normalizeData(value: unknown): ChoirData {
  const raw = typeof value === "object" && value !== null ? value as Partial<ChoirData> : {};
  const settings = normalizeSettings(raw.settings);
  const queue = sanitizeStringArray(raw.queue).filter(isAudioPath);
  const playlists = Array.isArray(raw.playlists)
    ? raw.playlists.flatMap((playlist): ChoirPlaylist[] => {
      if (typeof playlist !== "object" || playlist === null) return [];
      const candidate = playlist as Partial<ChoirPlaylist>;
      if (typeof candidate.name !== "string" || candidate.name.trim() === "") return [];
      return [{
        id: typeof candidate.id === "string" && candidate.id ? candidate.id : makeId(),
        name: candidate.name.trim(),
        trackPaths: sanitizeStringArray(candidate.trackPaths).filter(isAudioPath),
        createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : Date.now(),
        updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : Date.now(),
      }];
    })
    : [];

  const currentIndex = queue.length === 0
    ? -1
    : clamp(
      typeof raw.currentIndex === "number" ? Math.floor(raw.currentIndex) : 0,
      0,
      queue.length - 1,
    );

  return {
    playlists,
    queue,
    currentIndex,
    repeatMode: isRepeatMode(raw.repeatMode) ? raw.repeatMode : DEFAULT_DATA.repeatMode,
    shuffle: raw.shuffle === true,
    volume: clamp(typeof raw.volume === "number" ? raw.volume : DEFAULT_VOLUME, 0, 1),
    recentlyPlayed: sanitizeRecent((raw as Partial<ChoirData>).recentlyPlayed)
      .sort((a, b) => b.playedAt - a.playedAt)
      .slice(0, settings.recentLimit),
    settings,
  };
}

function cloneSettings(settings: ChoirSettings): ChoirSettings {
  return {
    ...settings,
    musicFolders: [...settings.musicFolders],
    excludedFolders: [...settings.excludedFolders],
    tabOrder: [...settings.tabOrder],
  };
}

function cloneChoirData(data: ChoirData): ChoirData {
  return {
    playlists: data.playlists.map((playlist) => ({
      ...playlist,
      trackPaths: [...playlist.trackPaths],
    })),
    queue: [...data.queue],
    currentIndex: data.currentIndex,
    repeatMode: data.repeatMode,
    shuffle: data.shuffle,
    volume: data.volume,
    recentlyPlayed: data.recentlyPlayed.map((track) => ({ ...track })),
    settings: cloneSettings(data.settings),
  };
}

function dataForSave(data: ChoirData): ChoirData {
  const snapshot = cloneChoirData(data);
  if (!snapshot.settings.rememberQueue) {
    snapshot.queue = [];
    snapshot.currentIndex = -1;
  }
  return snapshot;
}

function readAscii(bytes: Uint8Array, start: number, length: number): string {
  let value = "";
  const end = Math.min(bytes.length, start + length);
  for (let index = start; index < end; index += 1) value += String.fromCharCode(bytes[index]);
  return value;
}

function readLatin1(bytes: Uint8Array, start: number, end: number): string {
  let value = "";
  const safeEnd = Math.min(bytes.length, end);
  for (let index = start; index < safeEnd; index += 1) value += String.fromCharCode(bytes[index]);
  return value;
}

function readUInt24BE(bytes: Uint8Array, offset: number): number {
  if (offset + 3 > bytes.length) return 0;
  return (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) return 0;
  return (
    (bytes[offset] * 0x1000000)
    + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8)
    + bytes[offset + 3]
  );
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) return 0;
  return (
    bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] * 0x1000000)
  );
}

function readUInt64BE(bytes: Uint8Array, offset: number): number {
  const high = readUInt32BE(bytes, offset);
  const low = readUInt32BE(bytes, offset + 4);
  return high * 0x100000000 + low;
}

function cleanTagValue(value: string): string {
  return value
    .replace(/\u0000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mergeMetadata(base: TrackMetadata, next: TrackMetadata): TrackMetadata {
  return {
    title: base.title ?? next.title,
    artist: base.artist ?? next.artist,
    albumArtist: base.albumArtist ?? next.albumArtist,
    album: base.album ?? next.album,
    genre: base.genre ?? next.genre,
    year: base.year ?? next.year,
    trackNumber: base.trackNumber ?? next.trackNumber,
  };
}

function hasMetadata(metadata: TrackMetadata): boolean {
  return Boolean(
    metadata.title
    || metadata.artist
    || metadata.albumArtist
    || metadata.album
    || metadata.genre
    || metadata.year
    || metadata.trackNumber,
  );
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return readLatin1(bytes, 0, bytes.length);
  }
}

function decodeUtf16(bytes: Uint8Array, bigEndian: boolean): string {
  const start = bytes.length >= 2 && (
    (bytes[0] === 0xff && bytes[1] === 0xfe)
    || (bytes[0] === 0xfe && bytes[1] === 0xff)
  ) ? 2 : 0;
  const actualBigEndian = bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff
    ? true
    : bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe
      ? false
      : bigEndian;
  let value = "";
  for (let index = start; index + 1 < bytes.length; index += 2) {
    const code = actualBigEndian ? (bytes[index] << 8) | bytes[index + 1] : bytes[index] | (bytes[index + 1] << 8);
    if (code === 0) continue;
    value += String.fromCharCode(code);
  }
  return value;
}

function decodeId3Text(body: Uint8Array): string {
  if (body.length === 0) return "";
  const encoding = body[0];
  const payload = body.slice(1);
  if (encoding === 1) return cleanTagValue(decodeUtf16(payload, false));
  if (encoding === 2) return cleanTagValue(decodeUtf16(payload, true));
  if (encoding === 3) return cleanTagValue(decodeUtf8(payload));
  return cleanTagValue(readLatin1(payload, 0, payload.length));
}

function readSyncSafeInt(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) return 0;
  return (
    ((bytes[offset] & 0x7f) << 21)
    | ((bytes[offset + 1] & 0x7f) << 14)
    | ((bytes[offset + 2] & 0x7f) << 7)
    | (bytes[offset + 3] & 0x7f)
  );
}

function indexOfByte(bytes: Uint8Array, byte: number, start: number, end = bytes.length): number {
  const safeEnd = Math.min(end, bytes.length);
  for (let index = start; index < safeEnd; index += 1) {
    if (bytes[index] === byte) return index;
  }
  return -1;
}

function removeUnsynchronization(bytes: Uint8Array): Uint8Array {
  const clean: number[] = [];
  for (let index = 0; index < bytes.length; index += 1) {
    clean.push(bytes[index]);
    if (bytes[index] === 0xff && bytes[index + 1] === 0x00) index += 1;
  }
  return new Uint8Array(clean);
}

function terminatorLengthForEncoding(encoding: number): number {
  return encoding === 1 || encoding === 2 ? 2 : 1;
}

function findEncodedTerminator(bytes: Uint8Array, start: number, encoding: number): number {
  if (encoding === 1 || encoding === 2) {
    for (let index = start; index + 1 < bytes.length; index += 1) {
      if (bytes[index] === 0x00 && bytes[index + 1] === 0x00) return index;
    }
    return -1;
  }

  return indexOfByte(bytes, 0x00, start);
}

function findImageStart(bytes: Uint8Array, start: number): number {
  for (let index = start; index + 12 < bytes.length; index += 1) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xd8 && bytes[index + 2] === 0xff) return index;
    if (
      bytes[index] === 0x89
      && bytes[index + 1] === 0x50
      && bytes[index + 2] === 0x4e
      && bytes[index + 3] === 0x47
    ) return index;
    if (readAscii(bytes, index, 4) === "RIFF" && readAscii(bytes, index + 8, 4) === "WEBP") return index;
    if (readAscii(bytes, index, 3) === "GIF") return index;
  }
  return -1;
}

function sniffImageMime(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 4 && bytes[0] === 0x89 && readAscii(bytes, 1, 3) === "PNG") return "image/png";
  if (bytes.length >= 12 && readAscii(bytes, 0, 4) === "RIFF" && readAscii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (bytes.length >= 3 && readAscii(bytes, 0, 3) === "GIF") return "image/gif";
  return "image/jpeg";
}

function normalizeImageMime(mimeType: string, data: Uint8Array): string {
  const normalized = mimeType.trim().toLowerCase();
  if (normalized === "image/jpg" || normalized === "jpg" || normalized === "jpeg") return "image/jpeg";
  if (normalized === "png") return "image/png";
  if (normalized === "webp") return "image/webp";
  if (normalized.startsWith("image/")) return normalized;
  return sniffImageMime(data);
}

function parseApicFrame(body: Uint8Array): EmbeddedPicture | null {
  if (body.length < 8) return null;

  const encoding = body[0];
  const mimeEnd = indexOfByte(body, 0x00, 1);
  if (mimeEnd === -1) return null;

  const mimeType = readLatin1(body, 1, mimeEnd);
  const pictureTypeOffset = mimeEnd + 1;
  const descriptionStart = pictureTypeOffset + 1;
  if (descriptionStart >= body.length) return null;

  const descriptionEnd = findEncodedTerminator(body, descriptionStart, encoding);
  const parsedImageStart = descriptionEnd === -1
    ? -1
    : descriptionEnd + terminatorLengthForEncoding(encoding);
  const fallbackImageStart = findImageStart(body, descriptionStart);
  const imageStart = parsedImageStart > 0 && parsedImageStart < body.length
    ? parsedImageStart
    : fallbackImageStart;

  if (imageStart < 0 || imageStart >= body.length) return null;

  const data = body.slice(imageStart);
  return {
    mimeType: normalizeImageMime(mimeType, data),
    data,
  };
}

function parsePicFrame(body: Uint8Array): EmbeddedPicture | null {
  if (body.length < 8) return null;
  const encoding = body[0];
  const format = readAscii(body, 1, 3);
  const descriptionStart = 5;
  const descriptionEnd = findEncodedTerminator(body, descriptionStart, encoding);
  const parsedImageStart = descriptionEnd === -1
    ? -1
    : descriptionEnd + terminatorLengthForEncoding(encoding);
  const fallbackImageStart = findImageStart(body, descriptionStart);
  const imageStart = parsedImageStart > 0 && parsedImageStart < body.length
    ? parsedImageStart
    : fallbackImageStart;

  if (imageStart < 0 || imageStart >= body.length) return null;

  const data = body.slice(imageStart);
  return {
    mimeType: normalizeImageMime(format, data),
    data,
  };
}

function readId3Picture(bytes: Uint8Array): EmbeddedPicture | null {
  if (bytes.length < 10 || readAscii(bytes, 0, 3) !== "ID3") return null;

  const version = bytes[3];
  const flags = bytes[5];
  const tagEnd = Math.min(bytes.length, 10 + readSyncSafeInt(bytes, 6));
  let tag: ByteArray = bytes.slice(10, tagEnd);
  if ((flags & 0x80) !== 0) tag = removeUnsynchronization(tag);

  let position = 0;
  if ((flags & 0x40) !== 0 && tag.length >= 4) {
    if (version === 4) {
      position += Math.max(0, readSyncSafeInt(tag, 0));
    } else if (version === 3) {
      position += 4 + Math.max(0, readUInt32BE(tag, 0));
    }
  }

  while (position < tag.length) {
    if (version === 2) {
      if (position + 6 > tag.length) break;
      const frameId = readAscii(tag, position, 3);
      if (!/^[A-Z0-9]{3}$/.test(frameId)) break;
      const frameSize = readUInt24BE(tag, position + 3);
      const frameStart = position + 6;
      const frameEnd = frameStart + frameSize;
      if (frameSize <= 0 || frameEnd > tag.length) break;
      if (frameId === "PIC") return parsePicFrame(tag.slice(frameStart, frameEnd));
      position = frameEnd;
      continue;
    }

    if (position + 10 > tag.length) break;
    const frameId = readAscii(tag, position, 4);
    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;
    const frameSize = version === 4 ? readSyncSafeInt(tag, position + 4) : readUInt32BE(tag, position + 4);
    const frameStart = position + 10;
    const frameEnd = frameStart + frameSize;
    if (frameSize <= 0 || frameEnd > tag.length) break;
    if (frameId === "APIC") return parseApicFrame(tag.slice(frameStart, frameEnd));
    position = frameEnd;
  }

  return null;
}

function readFlacPicture(bytes: Uint8Array): EmbeddedPicture | null {
  if (bytes.length < 4 || readAscii(bytes, 0, 4) !== "fLaC") return null;

  let position = 4;
  while (position + 4 <= bytes.length) {
    const header = bytes[position];
    const isLast = (header & 0x80) !== 0;
    const blockType = header & 0x7f;
    const blockLength = readUInt24BE(bytes, position + 1);
    const blockStart = position + 4;
    const blockEnd = blockStart + blockLength;
    if (blockEnd > bytes.length) return null;

    if (blockType === 6) {
      const picture = parseFlacPictureBlock(bytes.slice(blockStart, blockEnd));
      if (picture) return picture;
    }

    if (isLast) break;
    position = blockEnd;
  }

  return null;
}

function parseFlacPictureBlock(block: Uint8Array): EmbeddedPicture | null {
  if (block.length < 32) return null;

  let position = 4;
  const mimeLength = readUInt32BE(block, position);
  position += 4;
  if (position + mimeLength + 4 > block.length) return null;
  const mimeType = readLatin1(block, position, position + mimeLength);
  position += mimeLength;

  const descriptionLength = readUInt32BE(block, position);
  position += 4 + descriptionLength;
  position += 16;
  if (position + 4 > block.length) return null;

  const imageLength = readUInt32BE(block, position);
  position += 4;
  if (imageLength <= 0 || position + imageLength > block.length) return null;

  const data = block.slice(position, position + imageLength);
  return {
    mimeType: normalizeImageMime(mimeType, data),
    data,
  };
}

function readMp4Picture(bytes: Uint8Array): EmbeddedPicture | null {
  return findMp4Cover(bytes, 0, bytes.length, "", 0);
}

function findMp4Cover(bytes: Uint8Array, start: number, end: number, parentType: string, depth: number): EmbeddedPicture | null {
  if (depth > 10) return null;

  let position = start;
  while (position + 8 <= end) {
    let boxSize = readUInt32BE(bytes, position);
    const boxType = readAscii(bytes, position + 4, 4);
    let headerSize = 8;

    if (boxSize === 1) {
      if (position + 16 > end) break;
      boxSize = readUInt64BE(bytes, position + 8);
      headerSize = 16;
    } else if (boxSize === 0) {
      boxSize = end - position;
    }

    const boxEnd = position + boxSize;
    if (boxSize < headerSize || boxEnd > end) break;

    let payloadStart = position + headerSize;
    if (boxType === "meta") payloadStart += 4;

    if (boxType === "data" && parentType === "covr" && payloadStart + 8 <= boxEnd) {
      const dataType = readUInt32BE(bytes, payloadStart) & 0x00ffffff;
      const imageStart = payloadStart + 8;
      const data = bytes.slice(imageStart, boxEnd);
      const mimeType = dataType === 14 ? "image/png" : dataType === 13 ? "image/jpeg" : sniffImageMime(data);
      return { mimeType, data };
    }

    if (boxType === "moov" || boxType === "udta" || boxType === "meta" || boxType === "ilst" || boxType === "covr") {
      const found = findMp4Cover(bytes, payloadStart, boxEnd, boxType, depth + 1);
      if (found) return found;
    }

    position = boxEnd;
  }

  return null;
}

function readEmbeddedPicture(bytes: Uint8Array): EmbeddedPicture | null {
  return readId3Picture(bytes) ?? readFlacPicture(bytes) ?? readMp4Picture(bytes);
}

function assignMetadata(metadata: TrackMetadata, key: string, value: string): void {
  const clean = cleanTagValue(value);
  if (!clean) return;

  switch (key.toUpperCase()) {
    case "TIT2":
    case "TT2":
    case "TITLE":
    case "COPYRIGHT-NAM":
      metadata.title ??= clean;
      break;
    case "TPE1":
    case "TP1":
    case "ARTIST":
    case "COPYRIGHT-ART":
      metadata.artist ??= clean;
      break;
    case "TPE2":
    case "TP2":
    case "ALBUMARTIST":
    case "ALBUM ARTIST":
    case "AART":
      metadata.albumArtist ??= clean;
      break;
    case "TALB":
    case "TAL":
    case "ALBUM":
    case "COPYRIGHT-ALB":
      metadata.album ??= clean;
      break;
    case "TCON":
    case "TCO":
    case "GENRE":
    case "COPYRIGHT-GEN":
      metadata.genre ??= clean;
      break;
    case "TDRC":
    case "TYER":
    case "TYE":
    case "DATE":
    case "YEAR":
    case "COPYRIGHT-DAY":
      metadata.year ??= clean;
      break;
    case "TRCK":
    case "TRK":
    case "TRACKNUMBER":
      metadata.trackNumber ??= clean;
      break;
  }
}

function readId3Metadata(bytes: Uint8Array): TrackMetadata {
  const metadata: TrackMetadata = {};
  if (bytes.length < 10 || readAscii(bytes, 0, 3) !== "ID3") return metadata;

  const version = bytes[3];
  const flags = bytes[5];
  const tagEnd = Math.min(bytes.length, 10 + readSyncSafeInt(bytes, 6));
  let tag: ByteArray = bytes.slice(10, tagEnd);
  if ((flags & 0x80) !== 0) tag = removeUnsynchronization(tag);

  let position = 0;
  if ((flags & 0x40) !== 0 && tag.length >= 4) {
    if (version === 4) {
      position += Math.max(0, readSyncSafeInt(tag, 0));
    } else if (version === 3) {
      position += 4 + Math.max(0, readUInt32BE(tag, 0));
    }
  }

  while (position < tag.length) {
    if (version === 2) {
      if (position + 6 > tag.length) break;
      const frameId = readAscii(tag, position, 3);
      if (!/^[A-Z0-9]{3}$/.test(frameId)) break;
      const frameSize = readUInt24BE(tag, position + 3);
      const frameStart = position + 6;
      const frameEnd = frameStart + frameSize;
      if (frameSize <= 0 || frameEnd > tag.length) break;
      if (frameId.startsWith("T")) assignMetadata(metadata, frameId, decodeId3Text(tag.slice(frameStart, frameEnd)));
      position = frameEnd;
      continue;
    }

    if (position + 10 > tag.length) break;
    const frameId = readAscii(tag, position, 4);
    if (!/^[A-Z0-9]{4}$/.test(frameId)) break;
    const frameSize = version === 4 ? readSyncSafeInt(tag, position + 4) : readUInt32BE(tag, position + 4);
    const frameStart = position + 10;
    const frameEnd = frameStart + frameSize;
    if (frameSize <= 0 || frameEnd > tag.length) break;
    if (frameId.startsWith("T")) assignMetadata(metadata, frameId, decodeId3Text(tag.slice(frameStart, frameEnd)));
    position = frameEnd;
  }

  return metadata;
}

function readFlacMetadata(bytes: Uint8Array): TrackMetadata {
  const metadata: TrackMetadata = {};
  if (bytes.length < 4 || readAscii(bytes, 0, 4) !== "fLaC") return metadata;

  let position = 4;
  while (position + 4 <= bytes.length) {
    const header = bytes[position];
    const isLast = (header & 0x80) !== 0;
    const blockType = header & 0x7f;
    const blockLength = readUInt24BE(bytes, position + 1);
    const blockStart = position + 4;
    const blockEnd = blockStart + blockLength;
    if (blockEnd > bytes.length) break;

    if (blockType === 4) {
      parseVorbisComments(bytes.slice(blockStart, blockEnd), metadata);
      return metadata;
    }

    if (isLast) break;
    position = blockEnd;
  }

  return metadata;
}

function parseVorbisComments(block: Uint8Array, metadata: TrackMetadata): void {
  let position = 0;
  const vendorLength = readUInt32LE(block, position);
  position += 4 + vendorLength;
  if (position + 4 > block.length) return;

  const count = readUInt32LE(block, position);
  position += 4;
  for (let index = 0; index < count && position + 4 <= block.length; index += 1) {
    const length = readUInt32LE(block, position);
    position += 4;
    if (position + length > block.length) return;
    const comment = decodeUtf8(block.slice(position, position + length));
    position += length;
    const equals = comment.indexOf("=");
    if (equals <= 0) continue;
    assignMetadata(metadata, comment.slice(0, equals), comment.slice(equals + 1));
  }
}

function readMp4BoxKey(bytes: Uint8Array, offset: number): string {
  if (offset + 4 > bytes.length) return "";
  if (bytes[offset] === 0xa9) return `copyright-${readAscii(bytes, offset + 1, 3)}`;
  return readAscii(bytes, offset, 4);
}

function readMp4Metadata(bytes: Uint8Array): TrackMetadata {
  const metadata: TrackMetadata = {};
  parseMp4MetadataBoxes(bytes, 0, bytes.length, "", 0, metadata);
  return metadata;
}

function parseMp4MetadataBoxes(
  bytes: Uint8Array,
  start: number,
  end: number,
  parentKey: string,
  depth: number,
  metadata: TrackMetadata,
): void {
  if (depth > 10) return;

  let position = start;
  while (position + 8 <= end) {
    let boxSize = readUInt32BE(bytes, position);
    const key = readMp4BoxKey(bytes, position + 4);
    let headerSize = 8;

    if (boxSize === 1) {
      if (position + 16 > end) break;
      boxSize = readUInt64BE(bytes, position + 8);
      headerSize = 16;
    } else if (boxSize === 0) {
      boxSize = end - position;
    }

    const boxEnd = position + boxSize;
    if (boxSize < headerSize || boxEnd > end) break;

    let payloadStart = position + headerSize;
    if (key === "meta") payloadStart += 4;

    if (key === "data" && parentKey) {
      const dataStart = payloadStart + 8;
      if (dataStart <= boxEnd) assignMetadata(metadata, parentKey, decodeUtf8(bytes.slice(dataStart, boxEnd)));
    }

    const shouldRecurse = key === "moov" || key === "udta" || key === "meta" || key === "ilst" || parentKey === "ilst";
    if (shouldRecurse && key !== "data") {
      parseMp4MetadataBoxes(bytes, payloadStart, boxEnd, key === "ilst" ? "ilst" : parentKey === "ilst" ? key : key, depth + 1, metadata);
    }

    position = boxEnd;
  }
}

function readEmbeddedMetadata(bytes: Uint8Array): TrackMetadata {
  return mergeMetadata(readId3Metadata(bytes), mergeMetadata(readFlacMetadata(bytes), readMp4Metadata(bytes)));
}

function rgbToHsl(color: RgbColor): { h: number; s: number; l: number } {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  if (max === g) h = (b - r) / d + 2;
  if (max === b) h = (r - g) / d + 4;

  return { h: h / 6, s, l };
}

function hueToRgb(p: number, q: number, t: number): number {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): RgbColor {
  if (s === 0) {
    const gray = Math.round(l * 255);
    return { r: gray, g: gray, b: gray };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hueToRgb(p, q, h) * 255),
    b: Math.round(hueToRgb(p, q, h - 1 / 3) * 255),
  };
}

function mixRgb(a: RgbColor, b: RgbColor, amount: number): RgbColor {
  return {
    r: Math.round(a.r + (b.r - a.r) * amount),
    g: Math.round(a.g + (b.g - a.g) * amount),
    b: Math.round(a.b + (b.b - a.b) * amount),
  };
}

function luminance(color: RgbColor): number {
  return (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
}

function paletteColorToCss(color: RgbColor): string {
  return `${color.r} ${color.g} ${color.b}`;
}

function tuneBackgroundColor(color: RgbColor): RgbColor {
  const hsl = rgbToHsl(color);
  return hslToRgb(hsl.h, clamp(hsl.s * 0.92, 0.18, 0.78), clamp(hsl.l * 0.34, 0.08, 0.22));
}

function tuneAccentColor(color: RgbColor): RgbColor {
  const hsl = rgbToHsl(color);
  if (hsl.s < 0.12) return DEFAULT_PALETTE.accent;
  return hslToRgb(hsl.h, clamp(hsl.s * 1.18, 0.45, 0.95), clamp(hsl.l, 0.42, 0.68));
}

async function imageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load cover image."));
    image.src = url;
  });
}

async function analyzeArtworkPalette(url: string): Promise<ArtworkPalette> {
  const image = await imageFromUrl(url);
  const canvas = document.createElement("canvas");
  const size = 56;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return DEFAULT_PALETTE;

  context.drawImage(image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  const buckets = new Map<string, { r: number; g: number; b: number; count: number; saturation: number; luminance: number }>();
  let total = 0;
  let average: RgbColor = { r: 0, g: 0, b: 0 };

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha < 150) continue;

    const color = { r: pixels[index], g: pixels[index + 1], b: pixels[index + 2] };
    total += 1;
    average = {
      r: average.r + color.r,
      g: average.g + color.g,
      b: average.b + color.b,
    };

    const key = [
      Math.round(color.r / 24) * 24,
      Math.round(color.g / 24) * 24,
      Math.round(color.b / 24) * 24,
    ].join("-");
    const hsl = rgbToHsl(color);
    const existing = buckets.get(key) ?? { r: 0, g: 0, b: 0, count: 0, saturation: 0, luminance: 0 };
    existing.r += color.r;
    existing.g += color.g;
    existing.b += color.b;
    existing.count += 1;
    existing.saturation += hsl.s;
    existing.luminance += luminance(color);
    buckets.set(key, existing);
  }

  if (total === 0 || buckets.size === 0) return DEFAULT_PALETTE;

  average = {
    r: Math.round(average.r / total),
    g: Math.round(average.g / total),
    b: Math.round(average.b / total),
  };

  const colors = [...buckets.values()].map((bucket) => {
    const color = {
      r: Math.round(bucket.r / bucket.count),
      g: Math.round(bucket.g / bucket.count),
      b: Math.round(bucket.b / bucket.count),
    };
    return {
      color,
      count: bucket.count,
      saturation: bucket.saturation / bucket.count,
      luminance: bucket.luminance / bucket.count,
    };
  });

  const dominant = colors
    .slice()
    .sort((a, b) => b.count - a.count)[0]?.color ?? average;
  const accent = colors
    .slice()
    .sort((a, b) => {
      const scoreA = a.count * 0.28 + a.saturation * 210 - Math.abs(a.luminance - 0.55) * 120;
      const scoreB = b.count * 0.28 + b.saturation * 210 - Math.abs(b.luminance - 0.55) * 120;
      return scoreB - scoreA;
    })[0]?.color ?? dominant;

  const background = tuneBackgroundColor(mixRgb(dominant, average, 0.35));
  return {
    background,
    accent: tuneAccentColor(accent),
    muted: mixRgb(background, tuneAccentColor(accent), 0.36),
  };
}

export default class ChoirPlugin extends Plugin {
  data: ChoirData = normalizeData(null);
  library: TFile[] = [];
  audio: HTMLAudioElement = new Audio();

  private views = new Set<ChoirView>();
  private currentPath: string | null = null;
  private shuffleHistory = new Set<number>();
  private statusEl: HTMLElement | null = null;
  private artworkCache = new Map<string, ArtworkCacheEntry>();
  private metadataCache = new Map<string, MetadataCacheEntry>();
  private artworkQueue: string[] = [];
  private metadataQueue: string[] = [];
  private artworkLoadsActive = 0;
  private metadataLoadsActive = 0;
  private artworkRefreshTimer: number | null = null;
  private metadataRefreshTimer: number | null = null;
  private saveTimer: number | null = null;
  private savePromise: Promise<void> = Promise.resolve();
  private volumeBeforeMute = DEFAULT_VOLUME;

  async onload(): Promise<void> {
    await this.loadChoirData();
    this.audio.preload = "metadata";
    this.audio.volume = this.data.volume;

    this.registerAudioEvents();
    this.refreshLibrary();

    this.registerView(VIEW_TYPE_CHOIR, (leaf) => new ChoirView(leaf, this));
    this.registerView(VIEW_TYPE_CHOIR_AUDIO_FILE, (leaf) => new ChoirAudioFileView(leaf, this));
    this.registerAudioExtensions();
    this.registerVaultEvents();
    this.registerClickRouting();
    this.registerFileMenu();
    this.registerCommands();

    this.addRibbonIcon("music", "Open Choir", () => {
      void this.activateView();
    });
    this.syncStatusBar();
    this.addSettingTab(new ChoirSettingTab(this.app, this));
  }

  onunload(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      void this.flushSave();
    }
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    if (this.artworkRefreshTimer !== null) window.clearTimeout(this.artworkRefreshTimer);
    if (this.metadataRefreshTimer !== null) window.clearTimeout(this.metadataRefreshTimer);
    for (const entry of this.artworkCache.values()) {
      if (entry.artwork) URL.revokeObjectURL(entry.artwork.objectUrl);
    }
    this.artworkQueue = [];
    this.metadataQueue = [];
    this.artworkCache.clear();
    this.metadataCache.clear();
  }

  async loadChoirData(): Promise<void> {
    this.data = normalizeData(await this.loadData());
  }

  async saveChoirData(): Promise<void> {
    await this.saveData(dataForSave(this.data));
  }

  registerViewInstance(view: ChoirView): void {
    this.views.add(view);
  }

  unregisterViewInstance(view: ChoirView): void {
    this.views.delete(view);
  }

  async activateView(): Promise<ChoirView | null> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHOIR)[0] ?? null;
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false)
        ?? this.app.workspace.getRightLeaf(true)
        ?? this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_CHOIR, active: true });
    }

    await this.app.workspace.revealLeaf(leaf);
    return leaf.view instanceof ChoirView ? leaf.view : null;
  }

  refreshLibrary(): void {
    this.library = this.app.vault
      .getFiles()
      .filter(isAudioFile)
      .filter((file) => this.isInConfiguredLibrary(file.path))
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: "base" }));
    this.broadcast("all");
  }

  private isInConfiguredLibrary(path: string): boolean {
    const normalized = normalizeFolderPath(path).toLowerCase();
    const { musicFolders, excludedFolders } = this.data.settings;
    const included = musicFolders.length === 0
      || musicFolders.some((folder) => this.pathMatchesFolder(normalized, folder));
    if (!included) return false;
    return !excludedFolders.some((folder) => this.pathMatchesFolder(normalized, folder));
  }

  private pathMatchesFolder(normalizedPath: string, folder: string): boolean {
    const normalizedFolder = normalizeFolderPath(folder).toLowerCase();
    return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
  }

  getAudioFile(path: string): TFile | null {
    const file = this.app.vault.getFileByPath(path);
    return file && isAudioFile(file) ? file : null;
  }

  getCurrentPath(): string | null {
    return this.data.currentIndex >= 0 ? this.data.queue[this.data.currentIndex] ?? null : null;
  }

  getCurrentFile(): TFile | null {
    const path = this.getCurrentPath();
    return path ? this.getAudioFile(path) : null;
  }

  getTrackDisplay(path: string): TrackDisplay {
    const file = this.getAudioFile(path);
    return file ? trackDisplayForFile(file, this.getTrackMetadata(path)) : trackDisplayForMissingPath(path);
  }

  getTrackMetadata(path: string): TrackMetadata | null {
    const file = this.getAudioFile(path);
    if (!file) return null;

    const cached = this.metadataCache.get(path);
    if (cached && cached.mtime === file.stat.mtime && cached.size === file.stat.size) {
      if (cached.status === "ready") return cached.metadata ?? null;
      return null;
    }

    this.startMetadataLoad(file);
    return null;
  }

  getArtistName(path: string): string {
    const metadata = this.getTrackMetadata(path);
    return metadata?.artist ?? metadata?.albumArtist ?? "Unknown Artist";
  }

  getAlbumName(path: string): string {
    return this.getTrackMetadata(path)?.album ?? "Unknown Album";
  }

  getArtistGroups(search: string): ArtistGroup[] {
    const tokens = normalizeSearch(search);
    const groups = new Map<string, string[]>();

    for (const file of this.library) {
      const artist = this.getArtistName(file.path);
      const metadata = this.getTrackMetadata(file.path);
      const display = this.getTrackDisplay(file.path);
      const haystack = `${artist} ${metadata?.album ?? ""} ${display.title} ${file.path}`.toLowerCase();
      if (tokens.length > 0 && !tokens.every((token) => haystack.includes(token))) continue;
      const paths = groups.get(artist) ?? [];
      paths.push(file.path);
      groups.set(artist, paths);
    }

    return [...groups.entries()]
      .map(([artist, paths]) => {
        const sortedPaths = paths.sort((a, b) => this.compareTrackPathsByAlbum(a, b));
        const albums = [...new Set(sortedPaths.map((path) => this.getAlbumName(path)).filter((album) => album !== "Unknown Album"))]
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
        return { artist, paths: sortedPaths, albums };
      })
      .sort((a, b) => {
        const artistCompare = a.artist.localeCompare(b.artist, undefined, { sensitivity: "base" });
        if (artistCompare !== 0) return artistCompare;
        return (a.albums[0] ?? "").localeCompare(b.albums[0] ?? "", undefined, { sensitivity: "base" });
      });
  }

  compareTrackPathsByAlbum(a: string, b: string): number {
    const aMetadata = this.getTrackMetadata(a);
    const bMetadata = this.getTrackMetadata(b);
    const albumCompare = (aMetadata?.album ?? "").localeCompare(bMetadata?.album ?? "", undefined, { sensitivity: "base" });
    if (albumCompare !== 0) return albumCompare;

    const trackCompare = parseTrackSortNumber(aMetadata?.trackNumber) - parseTrackSortNumber(bMetadata?.trackNumber);
    if (trackCompare !== 0) return trackCompare;

    return this.getTrackDisplay(a).title.localeCompare(this.getTrackDisplay(b).title, undefined, { sensitivity: "base" });
  }

  getRecentlyPlayedPaths(): string[] {
    return this.data.recentlyPlayed
      .filter((item) => this.getAudioFile(item.path))
      .sort((a, b) => b.playedAt - a.playedAt)
      .map((item) => item.path);
  }

  getArtwork(path: string): ArtworkData | null {
    const file = this.getAudioFile(path);
    if (!file) return null;

    const cached = this.artworkCache.get(path);
    if (cached && cached.mtime === file.stat.mtime && cached.size === file.stat.size) {
      if (cached.status === "ready") return cached.artwork ?? null;
      return null;
    }

    if (cached?.artwork) URL.revokeObjectURL(cached.artwork.objectUrl);
    this.startArtworkLoad(file);
    return null;
  }

  getCurrentArtwork(): ArtworkData | null {
    const path = this.getCurrentPath();
    return path ? this.getArtwork(path) : null;
  }

  getFilteredLibrary(search: string): TFile[] {
    const tokens = normalizeSearch(search);
    if (tokens.length === 0) return this.library;
    return this.library.filter((file) => {
      const metadata = this.getTrackMetadata(file.path);
      const haystack = `${file.basename} ${file.path} ${metadata?.title ?? ""} ${metadata?.artist ?? ""} ${metadata?.albumArtist ?? ""} ${metadata?.album ?? ""}`.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
  }

  private startMetadataLoad(file: TFile): void {
    const entry: MetadataCacheEntry = {
      mtime: file.stat.mtime,
      size: file.stat.size,
      status: "loading",
    };
    this.metadataCache.set(file.path, entry);
    this.metadataQueue.push(file.path);
    this.pumpMetadataQueue();
  }

  private pumpMetadataQueue(): void {
    while (this.metadataLoadsActive < MAX_METADATA_READS && this.metadataQueue.length > 0) {
      const path = this.metadataQueue.shift();
      if (!path) continue;

      const entry = this.metadataCache.get(path);
      const file = this.getAudioFile(path);
      if (!entry || entry.promise || !file) continue;
      if (entry.mtime !== file.stat.mtime || entry.size !== file.stat.size) continue;

      this.metadataLoadsActive += 1;
      entry.promise = this.extractMetadata(file)
        .then((metadata) => {
          const current = this.metadataCache.get(path);
          if (current !== entry) return;
          if (metadata && hasMetadata(metadata)) {
            current.status = "ready";
            current.metadata = metadata;
          } else {
            current.status = "missing";
          }
          this.scheduleMetadataRefresh();
        })
        .catch((error) => {
          console.warn(`[choir] Could not read embedded metadata from ${path}.`, error);
          const current = this.metadataCache.get(path);
          if (current === entry) {
            current.status = "missing";
            this.scheduleMetadataRefresh();
          }
        })
        .finally(() => {
          this.metadataLoadsActive -= 1;
          this.pumpMetadataQueue();
        });
    }
  }

  private async extractMetadata(file: TFile): Promise<TrackMetadata | null> {
    const buffer = await this.app.vault.readBinary(file);
    const metadata = readEmbeddedMetadata(new Uint8Array(buffer));
    return hasMetadata(metadata) ? metadata : null;
  }

  private scheduleMetadataRefresh(): void {
    if (this.metadataRefreshTimer !== null) return;
    this.metadataRefreshTimer = window.setTimeout(() => {
      this.metadataRefreshTimer = null;
      this.broadcast("content");
    }, 100);
  }

  private startArtworkLoad(file: TFile): void {
    const entry: ArtworkCacheEntry = {
      mtime: file.stat.mtime,
      size: file.stat.size,
      status: "loading",
    };
    this.artworkCache.set(file.path, entry);
    this.artworkQueue.push(file.path);
    this.pumpArtworkQueue();
  }

  private pumpArtworkQueue(): void {
    while (this.artworkLoadsActive < MAX_ARTWORK_READS && this.artworkQueue.length > 0) {
      const path = this.artworkQueue.shift();
      if (!path) continue;

      const entry = this.artworkCache.get(path);
      const file = this.getAudioFile(path);
      if (!entry || entry.promise || !file) continue;
      if (entry.mtime !== file.stat.mtime || entry.size !== file.stat.size) continue;

      this.artworkLoadsActive += 1;
      entry.promise = this.extractArtwork(file)
        .then((artwork) => {
          const current = this.artworkCache.get(path);
          if (current !== entry) {
            if (artwork) URL.revokeObjectURL(artwork.objectUrl);
            return;
          }

          if (artwork) {
            current.status = "ready";
            current.artwork = artwork;
          } else {
            current.status = "missing";
          }
          this.scheduleArtworkRefresh();
        })
        .catch((error) => {
          console.warn(`[choir] Could not read embedded artwork from ${path}.`, error);
          const current = this.artworkCache.get(path);
          if (current === entry) {
            current.status = "missing";
            this.scheduleArtworkRefresh();
          }
        })
        .finally(() => {
          this.artworkLoadsActive -= 1;
          this.pumpArtworkQueue();
        });
    }
  }

  private async extractArtwork(file: TFile): Promise<ArtworkData | null> {
    const buffer = await this.app.vault.readBinary(file);
    const picture = readEmbeddedPicture(new Uint8Array(buffer));
    if (!picture || picture.data.length === 0) return null;

    const objectUrl = URL.createObjectURL(new Blob([bytesToArrayBuffer(picture.data)], { type: picture.mimeType }));
    let palette = DEFAULT_PALETTE;
    try {
      palette = await analyzeArtworkPalette(objectUrl);
    } catch (error) {
      console.warn(`[choir] Could not derive artwork palette from ${file.path}.`, error);
    }

    return {
      objectUrl,
      mimeType: picture.mimeType,
      palette,
    };
  }

  private scheduleArtworkRefresh(): void {
    if (this.artworkRefreshTimer !== null) return;
    this.artworkRefreshTimer = window.setTimeout(() => {
      this.artworkRefreshTimer = null;
      this.broadcast("content");
    }, 80);
  }

  async playAudioFile(file: TFile, reveal = true): Promise<void> {
    if (!isAudioFile(file)) return;
    if (reveal) await this.activateView();
    if (this.data.settings.audioFileOpenMode === "folder") {
      const folderPath = file.parent?.path ?? "";
      const paths = this.library
        .filter((candidate) => (candidate.parent?.path ?? "") === folderPath)
        .map((candidate) => candidate.path);
      const index = Math.max(0, paths.indexOf(file.path));
      this.setQueue(paths.length > 0 ? paths : [file.path], index);
      await this.playCurrent();
      return;
    }

    this.setQueue([file.path], 0);
    await this.playCurrent();
  }

  async playPath(path: string): Promise<void> {
    if (!isAudioPath(path)) return;
    this.setQueue([path], 0);
    await this.playCurrent();
  }

  async playPathList(paths: string[], index: number): Promise<void> {
    const queue = paths.filter(isAudioPath);
    if (queue.length === 0) {
      new Notice("Choir did not find any playable tracks.");
      return;
    }

    this.setQueue(queue, clamp(index, 0, queue.length - 1));
    await this.playCurrent();
  }

  async playQueueIndex(index: number): Promise<void> {
    if (index < 0 || index >= this.data.queue.length) return;
    this.data.currentIndex = index;
    this.shuffleHistory.clear();
    this.saveSoon();
    await this.playCurrent();
  }

  async togglePlay(): Promise<void> {
    if (!this.audio.src && this.data.queue.length > 0) {
      if (this.data.currentIndex < 0) this.data.currentIndex = 0;
      await this.playCurrent();
      return;
    }

    if (!this.audio.src) {
      new Notice("Choose a song in Choir first.");
      return;
    }

    if (this.audio.paused) {
      await this.resumeAudio();
    } else {
      this.audio.pause();
    }
    this.broadcast("progress");
  }

  async playNextManual(): Promise<void> {
    const next = this.getNextIndex();
    if (next === -1) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.broadcast("all");
      return;
    }

    this.data.currentIndex = next;
    this.saveSoon();
    await this.playCurrent();
  }

  async playPreviousManual(): Promise<void> {
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      this.broadcast("progress");
      return;
    }

    if (this.data.queue.length === 0) return;
    if (this.data.currentIndex > 0) {
      this.data.currentIndex -= 1;
    } else if (this.data.repeatMode === "all") {
      this.data.currentIndex = this.data.queue.length - 1;
    } else {
      this.data.currentIndex = 0;
    }

    this.saveSoon();
    await this.playCurrent();
  }

  addToQueue(path: string, showNotice = true): void {
    if (!isAudioPath(path)) return;
    this.data.queue.push(path);
    if (this.data.currentIndex === -1) this.data.currentIndex = 0;
    this.shuffleHistory.clear();
    this.saveSoon();
    this.broadcast("all");
    if (showNotice) new Notice("Added to Choir queue.");
  }

  playNext(path: string): void {
    if (!isAudioPath(path)) return;
    const insertAt = this.data.currentIndex >= 0 ? this.data.currentIndex + 1 : 0;
    this.data.queue.splice(insertAt, 0, path);
    if (this.data.currentIndex === -1) this.data.currentIndex = 0;
    this.shuffleHistory.clear();
    this.saveSoon();
    this.broadcast("all");
    new Notice("Queued next in Choir.");
  }

  clearQueue(): void {
    this.data.queue = [];
    this.data.currentIndex = -1;
    this.currentPath = null;
    this.shuffleHistory.clear();
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.saveSoon();
    this.broadcast("all");
  }

  async removeQueueIndex(index: number): Promise<void> {
    if (index < 0 || index >= this.data.queue.length) return;
    const wasCurrent = index === this.data.currentIndex;
    this.data.queue.splice(index, 1);

    if (this.data.queue.length === 0) {
      this.clearQueue();
      return;
    }

    if (index < this.data.currentIndex) {
      this.data.currentIndex -= 1;
    } else if (wasCurrent) {
      this.data.currentIndex = clamp(index, 0, this.data.queue.length - 1);
    }

    this.shuffleHistory.clear();
    this.saveSoon();
    if (wasCurrent) {
      await this.playCurrent();
    } else {
      this.broadcast("all");
    }
  }

  moveQueueIndex(index: number, delta: -1 | 1): void {
    const target = index + delta;
    if (index < 0 || target < 0 || index >= this.data.queue.length || target >= this.data.queue.length) return;

    const current = this.data.queue[index];
    this.data.queue[index] = this.data.queue[target];
    this.data.queue[target] = current;

    if (this.data.currentIndex === index) {
      this.data.currentIndex = target;
    } else if (this.data.currentIndex === target) {
      this.data.currentIndex = index;
    }

    this.shuffleHistory.clear();
    this.saveSoon();
    this.broadcast("all");
  }

  toggleShuffle(): void {
    this.setShuffle(!this.data.shuffle);
  }

  cycleRepeatMode(): void {
    if (this.data.repeatMode === "off") {
      this.data.repeatMode = "all";
    } else if (this.data.repeatMode === "all") {
      this.data.repeatMode = "one";
    } else {
      this.data.repeatMode = "off";
    }
    this.saveSoon();
    this.broadcast("all");
  }

  setVolume(volume: number): void {
    this.data.volume = clamp(volume, 0, 1);
    this.audio.volume = this.data.volume;
    if (this.data.volume > 0) {
      this.volumeBeforeMute = this.data.volume;
      this.audio.muted = false;
    }
    this.saveSoon();
    this.broadcast("progress");
  }

  toggleMute(): void {
    if (this.audio.muted || this.data.volume === 0) {
      if (this.data.volume === 0) {
        this.data.volume = this.volumeBeforeMute || DEFAULT_VOLUME;
        this.audio.volume = this.data.volume;
      }
      this.audio.muted = false;
    } else {
      this.volumeBeforeMute = this.data.volume;
      this.audio.muted = true;
    }

    this.saveSoon();
    this.broadcast("progress");
  }

  createPlaylist(name: string, trackPaths: string[]): ChoirPlaylist | null {
    const trimmed = name.trim();
    if (!trimmed) return null;

    const playlist: ChoirPlaylist = {
      id: makeId(),
      name: trimmed,
      trackPaths: trackPaths.filter(isAudioPath),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.data.playlists.push(playlist);
    this.saveSoon();
    this.broadcast("all");
    new Notice(`Created playlist "${playlist.name}".`);
    return playlist;
  }

  createPlaylistFromQueue(name: string): ChoirPlaylist | null {
    if (this.data.queue.length === 0) {
      new Notice("The Choir queue is empty.");
      return null;
    }
    return this.createPlaylist(name, [...this.data.queue]);
  }

  createPlaylistFromRecent(name: string): ChoirPlaylist | null {
    const paths = this.getRecentlyPlayedPaths();
    if (paths.length === 0) {
      new Notice("Choir has no recently played tracks yet.");
      return null;
    }
    return this.createPlaylist(name, paths);
  }

  clearRecentlyPlayed(): void {
    this.data.recentlyPlayed = [];
    this.saveSoon();
    this.broadcast("all");
  }

  setShuffle(enabled: boolean): void {
    this.data.shuffle = enabled;
    this.shuffleHistory.clear();
    if (enabled) this.markShuffleHistory();
    this.saveSoon();
    this.broadcast("all");
  }

  setRepeatMode(mode: RepeatMode): void {
    this.data.repeatMode = mode;
    this.saveSoon();
    this.broadcast("all");
  }

  updateSettings(settings: Partial<ChoirSettings>, refreshLibrary = false): void {
    this.data.settings = normalizeSettings({ ...this.data.settings, ...settings });
    this.trimRecentlyPlayed();
    this.syncStatusBar();
    this.saveSoon();
    if (refreshLibrary) {
      this.refreshLibrary();
    } else {
      this.broadcast("all");
    }
  }

  resetAppearanceSettings(): void {
    this.updateSettings({
      themeMode: DEFAULT_DATA.settings.themeMode,
      themeIntensity: DEFAULT_DATA.settings.themeIntensity,
      density: DEFAULT_DATA.settings.density,
      rowActions: DEFAULT_DATA.settings.rowActions,
      showTrackNumbers: DEFAULT_DATA.settings.showTrackNumbers,
      showCovers: DEFAULT_DATA.settings.showCovers,
      tabOrder: DEFAULT_DATA.settings.tabOrder,
    });
  }

  deletePlaylist(id: string): void {
    const playlist = this.data.playlists.find((candidate) => candidate.id === id);
    this.data.playlists = this.data.playlists.filter((candidate) => candidate.id !== id);
    this.saveSoon();
    this.broadcast("all");
    if (playlist) new Notice(`Deleted playlist "${playlist.name}".`);
  }

  addToPlaylist(id: string, path: string): void {
    const playlist = this.data.playlists.find((candidate) => candidate.id === id);
    if (!playlist || !isAudioPath(path)) return;
    playlist.trackPaths.push(path);
    playlist.updatedAt = Date.now();
    this.saveSoon();
    this.broadcast("all");
    new Notice(`Added to "${playlist.name}".`);
  }

  removeFromPlaylist(id: string, index: number): void {
    const playlist = this.data.playlists.find((candidate) => candidate.id === id);
    if (!playlist || index < 0 || index >= playlist.trackPaths.length) return;
    playlist.trackPaths.splice(index, 1);
    playlist.updatedAt = Date.now();
    this.saveSoon();
    this.broadcast("all");
  }

  async playPlaylist(id: string): Promise<void> {
    const playlist = this.data.playlists.find((candidate) => candidate.id === id);
    if (!playlist) return;
    const paths = playlist.trackPaths.filter((path) => this.getAudioFile(path));
    if (paths.length === 0) {
      new Notice("That playlist has no playable tracks.");
      return;
    }
    await this.playPathList(paths, 0);
  }

  enqueuePlaylist(id: string): void {
    const playlist = this.data.playlists.find((candidate) => candidate.id === id);
    if (!playlist) return;
    const paths = playlist.trackPaths.filter((path) => this.getAudioFile(path));
    if (paths.length === 0) {
      new Notice("That playlist has no playable tracks.");
      return;
    }
    for (const path of paths) this.addToQueue(path, false);
    new Notice(`Added "${playlist.name}" to the queue.`);
  }

  private registerAudioEvents(): void {
    this.registerDomEvent(this.audio, "play", () => {
      this.broadcast("progress");
    });
    this.registerDomEvent(this.audio, "pause", () => {
      this.broadcast("progress");
    });
    this.registerDomEvent(this.audio, "loadedmetadata", () => {
      this.broadcast("progress");
    });
    this.registerDomEvent(this.audio, "timeupdate", () => {
      this.broadcast("progress");
    });
    this.registerDomEvent(this.audio, "ended", () => {
      void this.handleEnded();
    });
    this.registerDomEvent(this.audio, "error", () => {
      const path = this.getCurrentPath();
      if (path) {
        new Notice(`Choir could not play "${basenameFromPath(path)}". The codec may not be supported here.`);
      }
      this.broadcast("all");
    });
  }

  private registerAudioExtensions(): void {
    for (const extension of AUDIO_EXTENSIONS) {
      try {
        this.registerExtensions([extension], VIEW_TYPE_CHOIR_AUDIO_FILE);
      } catch (error) {
        console.warn(`[choir] Could not register .${extension} with Choir.`, error);
      }
    }
  }

  private registerVaultEvents(): void {
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof TFile && isAudioFile(file)) this.refreshLibrary();
    }));

    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (!(file instanceof TFile) || !isAudioPath(file.path)) return;
      this.removePathEverywhere(file.path);
      this.refreshLibrary();
    }));

    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile) || !isAudioFile(file)) return;
      this.forgetArtwork(file.path);
      this.metadataCache.delete(file.path);
      if (this.isInConfiguredLibrary(file.path)) this.broadcast("content");
    }));

    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (!(file instanceof TFile) || (!isAudioPath(oldPath) && !isAudioFile(file))) return;
      if (isAudioFile(file)) {
        this.replacePathEverywhere(oldPath, file.path);
      } else {
        this.removePathEverywhere(oldPath);
      }
      this.refreshLibrary();
    }));
  }

  private registerClickRouting(): void {
    this.registerDomEvent(document, "click", (event) => {
      if (!this.data.settings.interceptAudioClicks) return;
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.closest(".choir-view")) return;

      const pathEl = target.closest("[data-path]");
      const path = pathEl?.getAttribute("data-path");
      if (!path || !isAudioPath(path)) return;

      const file = this.app.vault.getFileByPath(path);
      if (!file || !isAudioFile(file)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void this.playAudioFile(file);
    }, { capture: true });

    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (!this.data.settings.interceptAudioClicks) return;
      if (!file || !isAudioFile(file)) return;
      void this.activateView();
    }));
  }

  private registerFileMenu(): void {
    this.registerEvent(this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
      if (!(file instanceof TFile) || !isAudioFile(file)) return;

      menu.addSeparator();
      menu.addItem((item) => item
        .setTitle("Play in Choir")
        .setIcon("music")
        .onClick(() => {
          void this.playAudioFile(file);
        }));
      menu.addItem((item) => item
        .setTitle("Add to Choir queue")
        .setIcon("list-plus")
        .onClick(() => this.addToQueue(file.path)));
      menu.addItem((item) => item
        .setTitle("Play next in Choir")
        .setIcon("list-start")
        .onClick(() => this.playNext(file.path)));
    }));
  }

  private registerCommands(): void {
    this.addCommand({
      id: "open-choir",
      name: "Open Choir",
      icon: "music",
      callback: () => {
        void this.activateView();
      },
    });

    this.addCommand({
      id: "toggle-playback",
      name: "Toggle playback",
      icon: "play",
      callback: () => {
        void this.togglePlay();
      },
    });

    this.addCommand({
      id: "next-track",
      name: "Next track",
      icon: "skip-forward",
      callback: () => {
        void this.playNextManual();
      },
    });

    this.addCommand({
      id: "previous-track",
      name: "Previous track",
      icon: "skip-back",
      callback: () => {
        void this.playPreviousManual();
      },
    });

    this.addCommand({
      id: "cycle-repeat",
      name: "Cycle repeat mode",
      icon: "repeat",
      callback: () => this.cycleRepeatMode(),
    });

    this.addCommand({
      id: "make-playlist-from-queue",
      name: "Make playlist from current queue",
      icon: "save",
      callback: () => {
        this.openPlaylistModal("Save queue as playlist", `Queue ${new Date().toLocaleDateString()}`, (name) => {
          this.createPlaylistFromQueue(name);
        });
      },
    });
  }

  openPlaylistModal(title: string, defaultName: string, onSubmit: (name: string) => void): void {
    new PlaylistNameModal(this.app, title, defaultName, onSubmit).open();
  }

  private async playCurrent(): Promise<void> {
    const path = this.getCurrentPath();
    if (!path) {
      this.broadcast("all");
      return;
    }

    const file = this.getAudioFile(path);
    if (!file) {
      new Notice(`Choir could not find "${basenameFromPath(path)}".`);
      await this.removeQueueIndex(this.data.currentIndex);
      return;
    }

    const resourcePath = this.app.vault.getResourcePath(file);
    if (this.currentPath !== path || this.audio.src !== resourcePath) {
      this.currentPath = path;
      this.audio.src = resourcePath;
      this.audio.load();
    }

    this.getArtwork(file.path);
    this.markShuffleHistory();
    this.markRecentlyPlayed(file.path);
    this.saveSoon();
    await this.resumeAudio();
    this.broadcast("playback");
  }

  private markRecentlyPlayed(path: string): void {
    this.data.recentlyPlayed = [
      { path, playedAt: Date.now() },
      ...this.data.recentlyPlayed.filter((item) => item.path !== path),
    ].slice(0, this.data.settings.recentLimit);
  }

  private trimRecentlyPlayed(): void {
    this.data.recentlyPlayed = this.data.recentlyPlayed
      .sort((a, b) => b.playedAt - a.playedAt)
      .slice(0, this.data.settings.recentLimit);
  }

  private async resumeAudio(): Promise<void> {
    try {
      await this.audio.play();
    } catch (error) {
      console.error("[choir] Playback failed.", error);
      new Notice("Choir could not start playback. Try clicking Play again.");
    }
  }

  private async handleEnded(): Promise<void> {
    if (this.data.repeatMode === "one") {
      this.audio.currentTime = 0;
      await this.resumeAudio();
      return;
    }

    const next = this.getNextIndex();
    if (next === -1) {
      this.audio.pause();
      this.audio.currentTime = 0;
      this.broadcast("all");
      return;
    }

    this.data.currentIndex = next;
    this.saveSoon();
    await this.playCurrent();
  }

  private getNextIndex(): number {
    const count = this.data.queue.length;
    if (count === 0) return -1;
    if (count === 1) return this.data.repeatMode === "all" ? 0 : -1;

    if (this.data.shuffle) {
      const unplayed = this.data.queue
        .map((_, index) => index)
        .filter((index) => index !== this.data.currentIndex && !this.shuffleHistory.has(index));

      if (unplayed.length > 0) {
        return unplayed[Math.floor(Math.random() * unplayed.length)];
      }

      if (this.data.repeatMode === "all") {
        this.shuffleHistory.clear();
        const choices = this.data.queue.map((_, index) => index).filter((index) => index !== this.data.currentIndex);
        return choices[Math.floor(Math.random() * choices.length)];
      }

      return -1;
    }

    if (this.data.currentIndex < count - 1) return this.data.currentIndex + 1;
    return this.data.repeatMode === "all" ? 0 : -1;
  }

  private setQueue(paths: string[], currentIndex: number): void {
    const queue = paths.filter(isAudioPath);
    this.data.queue = queue;
    this.data.currentIndex = queue.length === 0 ? -1 : clamp(currentIndex, 0, queue.length - 1);
    this.shuffleHistory.clear();
    this.markShuffleHistory();
    this.saveSoon();
  }

  private markShuffleHistory(): void {
    if (this.data.currentIndex >= 0) this.shuffleHistory.add(this.data.currentIndex);
  }

  private replacePathEverywhere(oldPath: string, newPath: string): void {
    let changed = false;
    const cachedArtwork = this.artworkCache.get(oldPath);
    if (cachedArtwork) {
      this.artworkCache.delete(oldPath);
      this.artworkCache.set(newPath, cachedArtwork);
    }
    const cachedMetadata = this.metadataCache.get(oldPath);
    if (cachedMetadata) {
      this.metadataCache.delete(oldPath);
      this.metadataCache.set(newPath, cachedMetadata);
    }

    this.data.queue = this.data.queue.map((path) => {
      if (path !== oldPath) return path;
      changed = true;
      return newPath;
    });

    for (const playlist of this.data.playlists) {
      playlist.trackPaths = playlist.trackPaths.map((path) => {
        if (path !== oldPath) return path;
        changed = true;
        playlist.updatedAt = Date.now();
        return newPath;
      });
    }

    this.data.recentlyPlayed = this.data.recentlyPlayed.map((item) => {
      if (item.path !== oldPath) return item;
      changed = true;
      return { ...item, path: newPath };
    });

    if (this.currentPath === oldPath) {
      this.currentPath = newPath;
      changed = true;
    }

    if (changed) {
      this.saveSoon();
      this.broadcast("all");
    }
  }

  private removePathEverywhere(pathToRemove: string): void {
    let changed = false;
    const oldQueue = this.data.queue;
    const oldCurrentIndex = this.data.currentIndex;
    const currentPath = oldCurrentIndex >= 0 ? oldQueue[oldCurrentIndex] ?? null : null;
    this.forgetArtwork(pathToRemove);
    this.metadataCache.delete(pathToRemove);

    const queueBefore = oldQueue.length;
    const removedBeforeCurrent = oldCurrentIndex > 0
      ? oldQueue.slice(0, oldCurrentIndex).filter((path) => path === pathToRemove).length
      : 0;
    const removedCurrent = currentPath === pathToRemove;

    this.data.queue = oldQueue.filter((path) => path !== pathToRemove);
    changed ||= this.data.queue.length !== queueBefore;
    if (this.data.queue.length === 0) {
      this.data.currentIndex = -1;
    } else if (removedCurrent) {
      this.data.currentIndex = clamp(oldCurrentIndex, 0, this.data.queue.length - 1);
    } else if (oldCurrentIndex >= 0) {
      this.data.currentIndex = clamp(oldCurrentIndex - removedBeforeCurrent, 0, this.data.queue.length - 1);
    } else {
      this.data.currentIndex = -1;
    }

    for (const playlist of this.data.playlists) {
      const before = playlist.trackPaths.length;
      playlist.trackPaths = playlist.trackPaths.filter((path) => path !== pathToRemove);
      if (before !== playlist.trackPaths.length) {
        playlist.updatedAt = Date.now();
        changed = true;
      }
    }

    const recentBefore = this.data.recentlyPlayed.length;
    this.data.recentlyPlayed = this.data.recentlyPlayed.filter((item) => item.path !== pathToRemove);
    changed ||= recentBefore !== this.data.recentlyPlayed.length;

    if (currentPath === pathToRemove || this.currentPath === pathToRemove) {
      this.currentPath = null;
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      changed = true;
    }

    if (changed) {
      this.shuffleHistory.clear();
      this.saveSoon();
      this.broadcast("all");
    }
  }

  private forgetArtwork(path: string): void {
    const entry = this.artworkCache.get(path);
    if (entry?.artwork) URL.revokeObjectURL(entry.artwork.objectUrl);
    this.artworkCache.delete(path);
  }

  private broadcast(kind: BroadcastKind): void {
    for (const view of this.views) {
      if (kind === "progress") {
        view.updateProgress();
      } else if (kind === "content") {
        view.updateContent();
      } else if (kind === "playback") {
        view.updatePlayback();
      } else {
        view.render();
      }
    }
    this.updateStatus();
  }

  private syncStatusBar(): void {
    if (this.data.settings.showStatusBar) {
      if (!this.statusEl) this.statusEl = this.addStatusBarItem();
      this.updateStatus();
      return;
    }

    this.statusEl?.remove();
    this.statusEl = null;
  }

  private updateStatus(): void {
    if (!this.statusEl) return;
    const file = this.getCurrentFile();
    if (!file) {
      this.statusEl.setText("Choir idle");
      return;
    }

    const state = this.audio.paused ? "Paused" : "Playing";
    this.statusEl.setText(`${state}: ${file.basename}`);
  }

  private saveSoon(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.flushSave();
    }, 250);
  }

  private flushSave(): Promise<void> {
    const run = this.savePromise.then(() => this.saveChoirData());
    this.savePromise = run.catch((error) => {
      console.warn("[choir] Could not save plugin data.", error);
    });
    return this.savePromise;
  }
}

class ChoirView extends ItemView {
  private activeTab: ChoirTab = "library";
  private search = "";
  private selectedPlaylistId: string | null = null;
  private selectedArtist: string | null = null;
  private bodyEl: HTMLElement | null = null;
  private playerEl: HTMLElement | null = null;
  private progressEl: HTMLInputElement | null = null;
  private elapsedEl: HTMLElement | null = null;
  private durationEl: HTMLElement | null = null;
  private volumeEl: HTMLInputElement | null = null;
  private volumeButtonEl: HTMLButtonElement | null = null;
  private playButtonEl: HTMLButtonElement | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: ChoirPlugin) {
    super(leaf);
    this.icon = "music";
  }

  getViewType(): string {
    return VIEW_TYPE_CHOIR;
  }

  getDisplayText(): string {
    return "Choir";
  }

  protected async onOpen(): Promise<void> {
    this.plugin.registerViewInstance(this);
    this.render();
  }

  protected async onClose(): Promise<void> {
    this.plugin.unregisterViewInstance(this);
  }

  render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("choir-view");
    this.applyDisplaySettings(root);
    this.applyArtworkTheme(root);

    const shell = root.createDiv({ cls: "choir-shell" });
    this.renderHeader(shell);
    this.renderTabs(shell);
    this.bodyEl = shell.createDiv({ cls: "choir-body" });
    this.renderActivePanel();
    this.renderPlayer(shell);
    this.updateProgress();
  }

  updatePlayback(): void {
    if (this.activeTab === "queue" && !this.queueBodyMatchesData()) {
      this.render();
      return;
    }

    if (this.activeTab === "recent") {
      this.render();
      return;
    }

    this.applyArtworkTheme(this.contentEl);
    this.updateCurrentRows();

    if (this.playerEl) {
      this.playerEl.empty();
      this.renderPlayerContents(this.playerEl);
    }
    this.updateProgress();
  }

  updateContent(): void {
    if (this.shouldRenderForContentRefresh()) {
      this.render();
      return;
    }

    this.applyArtworkTheme(this.contentEl);
    this.updateVisibleTrackRows();
    this.updateCurrentRows();

    if (this.playerEl) {
      this.playerEl.empty();
      this.renderPlayerContents(this.playerEl);
    }
    this.updateProgress();
  }

  updateProgress(): void {
    const audio = this.plugin.audio;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;

    if (this.progressEl) {
      this.progressEl.max = duration > 0 ? `${duration}` : "0";
      this.progressEl.value = `${Math.min(current, duration || current)}`;
      this.progressEl.disabled = duration <= 0;
    }

    if (this.elapsedEl) this.elapsedEl.setText(formatTime(current));
    if (this.durationEl) this.durationEl.setText(formatTime(duration));
    if (this.volumeEl) this.volumeEl.value = `${Math.round(this.plugin.data.volume * 100)}`;
    this.updatePlaybackIcon();
    this.updateVolumeIcon();
  }

  private updateCurrentRows(): void {
    if (!this.bodyEl) return;
    const currentPath = this.plugin.getCurrentPath();
    const currentIndex = this.plugin.data.currentIndex;
    const rows = this.bodyEl.querySelectorAll<HTMLElement>(".choir-track-row[data-choir-path]");

    rows.forEach((row) => {
      const path = row.dataset.choirPath ?? "";
      const queueIndex = row.dataset.choirQueueIndex;
      const isCurrent = queueIndex === undefined
        ? path === currentPath
        : path === currentPath && Number(queueIndex) === currentIndex;
      row.toggleClass("is-current", isCurrent);
    });
  }

  private updateVisibleTrackRows(): void {
    if (!this.bodyEl) return;
    const rows = this.bodyEl.querySelectorAll<HTMLElement>(".choir-track-row[data-choir-path]");

    rows.forEach((row) => {
      const path = row.dataset.choirPath;
      if (!path) return;

      const display = this.plugin.getTrackDisplay(path);
      const title = row.querySelector<HTMLElement>(".choir-track-title");
      const subtitle = row.querySelector<HTMLElement>(".choir-track-subtitle");
      const cover = row.querySelector<HTMLElement>(".choir-track-cover");

      if (title) title.setText(display.title);
      if (subtitle) subtitle.setText(display.subtitle);
      if (cover && this.plugin.data.settings.showCovers) this.fillCover(cover, path);
    });
  }

  private shouldRenderForContentRefresh(): boolean {
    if (this.search.trim()) return true;
    return this.activeTab === "artists" && !this.selectedArtist;
  }

  private queueBodyMatchesData(): boolean {
    if (!this.bodyEl) return false;
    const rows = Array.from(this.bodyEl.querySelectorAll<HTMLElement>(".choir-track-row[data-choir-queue-index]"));
    if (rows.length !== this.plugin.data.queue.length) return false;

    return rows.every((row, index) => (
      row.dataset.choirPath === this.plugin.data.queue[index]
      && row.dataset.choirQueueIndex === `${index}`
    ));
  }

  private updatePlaybackIcon(): void {
    if (!this.playButtonEl) return;
    const paused = this.plugin.audio.paused;
    this.playButtonEl.empty();
    setIcon(this.playButtonEl, paused ? "play" : "pause");
    this.playButtonEl.setAttr("title", paused ? "Play" : "Pause");
    this.playButtonEl.setAttr("aria-label", paused ? "Play" : "Pause");
  }

  private updateVolumeIcon(): void {
    if (!this.volumeButtonEl) return;
    const muted = this.plugin.audio.muted || this.plugin.data.volume === 0;
    const icon = muted ? "volume-x" : this.plugin.data.volume < 0.5 ? "volume-1" : "volume-2";
    this.volumeButtonEl.empty();
    setIcon(this.volumeButtonEl, icon);
    this.volumeButtonEl.setAttr("title", muted ? "Unmute" : "Mute");
    this.volumeButtonEl.setAttr("aria-label", muted ? "Unmute" : "Mute");
  }

  private applyArtworkTheme(root: HTMLElement): void {
    const artwork = this.plugin.getCurrentArtwork();
    const settings = this.plugin.data.settings;
    const useCoverTheme = settings.themeMode === "cover" && Boolean(artwork);
    root.toggleClass("has-cover-theme", useCoverTheme);

    if (!artwork || !useCoverTheme) {
      root.style.setProperty("--choir-bg-rgb", paletteColorToCss(DEFAULT_PALETTE.background));
      root.style.setProperty("--choir-muted-rgb", paletteColorToCss(DEFAULT_PALETTE.muted));
      root.style.removeProperty("--choir-accent");
      return;
    }

    const intensity = settings.themeIntensity;
    root.style.setProperty("--choir-bg-rgb", paletteColorToCss(mixRgb(DEFAULT_PALETTE.background, artwork.palette.background, intensity)));
    root.style.setProperty("--choir-accent", `color-mix(in srgb, rgb(${paletteColorToCss(artwork.palette.accent)}) ${Math.round(intensity * 100)}%, var(--interactive-accent))`);
    root.style.setProperty("--choir-muted-rgb", paletteColorToCss(mixRgb(DEFAULT_PALETTE.muted, artwork.palette.muted, intensity)));
  }

  private applyDisplaySettings(root: HTMLElement): void {
    const settings = this.plugin.data.settings;
    root.toggleClass("is-compact", settings.density === "compact");
    root.toggleClass("show-row-actions", settings.rowActions === "always");
    root.toggleClass("hide-track-numbers", !settings.showTrackNumbers);
    root.toggleClass("hide-covers", !settings.showCovers);
    root.toggleClass("is-flush", !settings.floatingPanel);
  }

  private renderCover(parent: HTMLElement, path: string | null, extraClass: string): HTMLElement {
    const cover = parent.createDiv({ cls: `choir-cover ${extraClass}` });
    if (this.plugin.data.settings.showCovers) this.fillCover(cover, path);
    return cover;
  }

  private fillCover(cover: HTMLElement, path: string | null): void {
    cover.empty();
    cover.removeClass("is-placeholder");
    const artwork = path ? this.plugin.getArtwork(path) : null;

    if (artwork) {
      const image = cover.createEl("img", {
        cls: "choir-cover-image",
        attr: { alt: "" },
      });
      image.src = artwork.objectUrl;
    } else {
      cover.addClass("is-placeholder");
      setIcon(cover, "music-2");
    }
  }

  private renderHeader(parent: HTMLElement): void {
    const header = parent.createDiv({ cls: "choir-header" });
    const titleWrap = header.createDiv({ cls: "choir-title-wrap" });
    const icon = titleWrap.createSpan({ cls: "choir-logo" });
    setIcon(icon, "music-2");
    const titleMeta = titleWrap.createDiv({ cls: "choir-title-meta" });
    titleMeta.createDiv({ cls: "choir-title", text: "Choir" });
    titleMeta.createDiv({ cls: "choir-title-subtitle", text: `${plural(this.plugin.library.length, "track")} indexed` });

    const searchWrap = header.createDiv({ cls: "choir-search-wrap" });
    const searchIcon = searchWrap.createSpan({ cls: "choir-search-icon" });
    setIcon(searchIcon, "search");
    const searchInput = searchWrap.createEl("input", { cls: "choir-search-input" });
    searchInput.type = "search";
    searchInput.placeholder = "Search vault music";
    searchInput.value = this.search;
    searchInput.addEventListener("input", () => {
      this.search = searchInput.value;
      this.renderActivePanel();
      this.updateTabs();
    });
  }

  private renderTabs(parent: HTMLElement): void {
    const tabs = parent.createDiv({ cls: "choir-tabs" });
    for (const tab of this.plugin.data.settings.tabOrder) {
      const config = TAB_CONFIG[tab];
      this.renderTab(tabs, tab, config.label, config.icon);
    }
  }

  private renderTab(parent: HTMLElement, tab: ChoirTab, label: string, iconId: string): void {
    const button = parent.createEl("button", {
      cls: `choir-tab${this.activeTab === tab ? " is-active" : ""}`,
      attr: { type: "button", title: label, "aria-label": label },
    });
    const icon = button.createSpan({ cls: "choir-tab-icon" });
    setIcon(icon, iconId);
    button.createSpan({ text: label });
    button.addEventListener("click", () => {
      this.activeTab = tab;
      this.render();
    });
  }

  private updateTabs(): void {
    const order = this.plugin.data.settings.tabOrder;
    this.contentEl.querySelectorAll(".choir-tab").forEach((tab) => tab.removeClass("is-active"));
    this.contentEl.querySelectorAll(".choir-tab").forEach((tab, index) => {
      const activeIndex = order.indexOf(this.activeTab);
      if (index === activeIndex) tab.addClass("is-active");
    });
  }

  private renderActivePanel(): void {
    if (!this.bodyEl) return;
    this.bodyEl.empty();

    if (this.activeTab === "library") {
      this.renderLibrary(this.bodyEl);
    } else if (this.activeTab === "artists") {
      this.renderArtists(this.bodyEl);
    } else if (this.activeTab === "recent") {
      this.renderRecent(this.bodyEl);
    } else if (this.activeTab === "queue") {
      this.renderQueue(this.bodyEl);
    } else {
      this.renderPlaylists(this.bodyEl);
    }
  }

  private renderLibrary(parent: HTMLElement): void {
    const files = this.plugin.getFilteredLibrary(this.search);
    const toolbar = parent.createDiv({ cls: "choir-section-toolbar" });
    toolbar.createDiv({
      cls: "choir-section-title",
      text: this.search.trim() ? `${plural(files.length, "match", "matches")}` : `${plural(files.length, "track")}`,
    });
    this.textButton(toolbar, "refresh-cw", "Scan", "Rescan vault music", () => this.plugin.refreshLibrary(), "choir-small-button");

    if (files.length === 0) {
      this.renderEmpty(parent, "No audio files found", "MP3, FLAC, M4A, WAV, OGG, Opus, and similar files in the vault will appear here.");
      return;
    }

    const list = parent.createDiv({ cls: "choir-track-list" });
    files.forEach((file, index) => {
      this.renderLibraryTrack(list, file, index);
    });
  }

  private renderLibraryTrack(parent: HTMLElement, file: TFile, index: number): void {
    const isCurrent = this.plugin.getCurrentPath() === file.path;
    const display = this.plugin.getTrackDisplay(file.path);
    const row = parent.createDiv({ cls: `choir-track-row choir-library-row${isCurrent ? " is-current" : ""}` });
    row.dataset.choirPath = file.path;
    row.addEventListener("click", () => {
      void this.plugin.playPath(file.path);
    });
    row.createDiv({ cls: "choir-track-number", text: `${index + 1}` });
    this.renderCover(row, file.path, "choir-track-cover");

    const meta = row.createDiv({ cls: "choir-track-meta" });
    meta.createDiv({ cls: "choir-track-title", text: display.title });
    meta.createDiv({ cls: "choir-track-subtitle", text: display.subtitle });

    const actions = row.createDiv({ cls: "choir-track-actions" });
    this.iconButton(actions, "list-plus", "Add to queue", () => this.plugin.addToQueue(file.path));
    this.iconButton(actions, "more-horizontal", "More", (event) => this.openTrackMenu(event, file));
  }

  private renderArtists(parent: HTMLElement): void {
    const groups = this.plugin.getArtistGroups(this.search);
    const selected = this.selectedArtist
      ? groups.find((group) => group.artist === this.selectedArtist) ?? null
      : null;

    if (selected) {
      this.renderArtistDetail(parent, selected);
      return;
    }

    const toolbar = parent.createDiv({ cls: "choir-section-toolbar" });
    toolbar.createDiv({
      cls: "choir-section-title",
      text: this.search.trim() ? `${plural(groups.length, "artist match", "artist matches")}` : `${plural(groups.length, "artist")}`,
    });

    if (groups.length === 0) {
      this.renderEmpty(parent, "No artists found", "Choir will group tracks once artist tags are available in the audio metadata.");
      return;
    }

    const list = parent.createDiv({ cls: "choir-playlist-list" });
    for (const group of groups) {
      const row = list.createDiv({ cls: "choir-playlist-row" });
      row.addEventListener("click", () => {
        this.selectedArtist = group.artist;
        this.render();
      });
      this.renderCover(row, group.paths[0] ?? null, "choir-playlist-cover");
      const info = row.createDiv({ cls: "choir-playlist-info" });
      info.createDiv({ cls: "choir-playlist-title", text: group.artist });
      const albumText = group.albums.length > 0 ? ` - ${plural(group.albums.length, "album")}` : "";
      info.createDiv({ cls: "choir-playlist-subtitle", text: `${plural(group.paths.length, "track")}${albumText}` });

      const rowActions = row.createDiv({ cls: "choir-track-actions" });
      this.iconButton(rowActions, "list-plus", "Add artist to queue", () => {
        for (const path of group.paths) this.plugin.addToQueue(path, false);
        new Notice(`Added ${group.artist} to the queue.`);
      });
    }
  }

  private renderArtistDetail(parent: HTMLElement, group: ArtistGroup): void {
    const toolbar = parent.createDiv({ cls: "choir-section-toolbar choir-section-toolbar-stacked" });
    const top = toolbar.createDiv({ cls: "choir-detail-top" });
    this.iconButton(top, "arrow-left", "Back to artists", () => {
      this.selectedArtist = null;
      this.render();
    });
    const title = top.createDiv({ cls: "choir-playlist-heading" });
    title.createDiv({ cls: "choir-section-title", text: group.artist });
    const albumText = group.albums.length > 0 ? ` - ${plural(group.albums.length, "album")}` : "";
    title.createDiv({ cls: "choir-playlist-subtitle", text: `${plural(group.paths.length, "track")}${albumText}` });

    const actions = toolbar.createDiv({ cls: "choir-inline-actions" });
    this.textButton(actions, "list-plus", "Queue", "Add artist to queue", () => {
      for (const path of group.paths) this.plugin.addToQueue(path, false);
      new Notice(`Added ${group.artist} to the queue.`);
    }, "choir-small-button");

    const list = parent.createDiv({ cls: "choir-track-list" });
    group.paths.forEach((path, index) => this.renderPathTrack(list, path, index, (trackPath) => {
      void this.plugin.playPath(trackPath);
    }, "artist"));
  }

  private renderRecent(parent: HTMLElement): void {
    const paths = this.plugin.getRecentlyPlayedPaths();
    const tokens = normalizeSearch(this.search);
    const filtered = tokens.length === 0
      ? paths
      : paths.filter((path) => {
        const display = this.plugin.getTrackDisplay(path);
        const metadata = this.plugin.getTrackMetadata(path);
        const haystack = `${display.title} ${display.subtitle} ${metadata?.artist ?? ""} ${metadata?.album ?? ""}`.toLowerCase();
        return tokens.every((token) => haystack.includes(token));
      });

    const toolbar = parent.createDiv({ cls: "choir-section-toolbar" });
    toolbar.createDiv({
      cls: "choir-section-title",
      text: this.search.trim() ? `${plural(filtered.length, "recent match", "recent matches")}` : plural(paths.length, "recent track"),
    });
    const actions = toolbar.createDiv({ cls: "choir-inline-actions" });
    this.textButton(actions, "save", "Playlist", "Make playlist from recent", () => {
      this.plugin.openPlaylistModal("Save recent as playlist", `Recently played ${new Date().toLocaleDateString()}`, (name) => {
        const playlist = this.plugin.createPlaylistFromRecent(name);
        this.selectedPlaylistId = playlist?.id ?? null;
        this.activeTab = "playlists";
        this.render();
      });
    }, "choir-small-button", paths.length === 0);
    this.textButton(actions, "x", "Clear", "Clear recent", () => this.plugin.clearRecentlyPlayed(), "choir-small-button", paths.length === 0);

    if (filtered.length === 0) {
      this.renderEmpty(parent, "No recent tracks", "Tracks will appear here after Choir starts playback.");
      return;
    }

    const list = parent.createDiv({ cls: "choir-track-list" });
    filtered.forEach((path, index) => this.renderPathTrack(list, path, index, (trackPath) => {
      void this.plugin.playPath(trackPath);
    }, "recent"));
  }

  private renderPathTrack(
    parent: HTMLElement,
    path: string,
    index: number,
    onPlay: (path: string) => void,
    source: "artist" | "recent",
  ): void {
    const display = this.plugin.getTrackDisplay(path);
    const isCurrent = this.plugin.getCurrentPath() === path;
    const row = parent.createDiv({ cls: `choir-track-row choir-playable-row${isCurrent ? " is-current" : ""}${display.missing ? " is-missing" : ""}` });
    row.dataset.choirPath = path;
    row.addEventListener("click", () => {
      if (!display.missing) onPlay(path);
    });
    row.createDiv({ cls: "choir-track-number", text: `${index + 1}` });
    this.renderCover(row, path, "choir-track-cover");

    const meta = row.createDiv({ cls: "choir-track-meta" });
    meta.createDiv({ cls: "choir-track-title", text: display.title });
    meta.createDiv({ cls: "choir-track-subtitle", text: display.subtitle });

    const actions = row.createDiv({ cls: "choir-track-actions" });
    this.iconButton(actions, "list-plus", "Add to queue", () => this.plugin.addToQueue(path), display.missing);
    if (source === "recent") {
      this.iconButton(actions, "more-horizontal", "More", (event) => {
        const file = this.plugin.getAudioFile(path);
        if (file) this.openTrackMenu(event, file);
      }, display.missing);
    }
  }

  private renderQueue(parent: HTMLElement): void {
    const toolbar = parent.createDiv({ cls: "choir-section-toolbar" });
    toolbar.createDiv({ cls: "choir-section-title", text: plural(this.plugin.data.queue.length, "queued track") });
    const actions = toolbar.createDiv({ cls: "choir-inline-actions" });
    this.textButton(actions, "save", "Playlist", "Make playlist from queue", () => {
      this.plugin.openPlaylistModal("Save queue as playlist", `Queue ${new Date().toLocaleDateString()}`, (name) => {
        this.plugin.createPlaylistFromQueue(name);
        this.selectedPlaylistId = this.plugin.data.playlists[this.plugin.data.playlists.length - 1]?.id ?? null;
        this.activeTab = "playlists";
        this.render();
      });
    }, "choir-small-button", this.plugin.data.queue.length === 0);
    this.textButton(actions, "x", "Clear", "Clear queue", () => this.plugin.clearQueue(), "choir-small-button", this.plugin.data.queue.length === 0);

    if (this.plugin.data.queue.length === 0) {
      this.renderEmpty(parent, "Queue is empty", "Use Library search to add songs or play a playlist.");
      return;
    }

    const list = parent.createDiv({ cls: "choir-track-list" });
    this.plugin.data.queue.forEach((path, index) => this.renderQueueTrack(list, path, index));
  }

  private renderQueueTrack(parent: HTMLElement, path: string, index: number): void {
    const display = this.plugin.getTrackDisplay(path);
    const isCurrent = index === this.plugin.data.currentIndex;
    const row = parent.createDiv({ cls: `choir-track-row choir-playable-row${isCurrent ? " is-current" : ""}${display.missing ? " is-missing" : ""}` });
    row.dataset.choirPath = path;
    row.dataset.choirQueueIndex = `${index}`;
    row.addEventListener("click", () => {
      if (!display.missing) void this.plugin.playQueueIndex(index);
    });
    row.createDiv({ cls: "choir-track-number", text: `${index + 1}` });
    this.renderCover(row, path, "choir-track-cover");

    const meta = row.createDiv({ cls: "choir-track-meta" });
    meta.createDiv({ cls: "choir-track-title", text: display.title });
    meta.createDiv({ cls: "choir-track-subtitle", text: display.subtitle });

    const actions = row.createDiv({ cls: "choir-track-actions" });
    this.iconButton(actions, "arrow-up", "Move up", () => this.plugin.moveQueueIndex(index, -1), index === 0);
    this.iconButton(actions, "arrow-down", "Move down", () => this.plugin.moveQueueIndex(index, 1), index === this.plugin.data.queue.length - 1);
    this.iconButton(actions, "trash-2", "Remove", () => {
      void this.plugin.removeQueueIndex(index);
    });
  }

  private renderPlaylists(parent: HTMLElement): void {
    const selected = this.selectedPlaylistId
      ? this.plugin.data.playlists.find((playlist) => playlist.id === this.selectedPlaylistId) ?? null
      : null;

    if (selected) {
      this.renderPlaylistDetail(parent, selected);
      return;
    }

    const toolbar = parent.createDiv({ cls: "choir-section-toolbar" });
    toolbar.createDiv({ cls: "choir-section-title", text: plural(this.plugin.data.playlists.length, "playlist") });
    const actions = toolbar.createDiv({ cls: "choir-inline-actions" });
    this.textButton(actions, "plus", "New", "Create empty playlist", () => {
      this.plugin.openPlaylistModal("New playlist", "New playlist", (name) => {
        const playlist = this.plugin.createPlaylist(name, []);
        this.selectedPlaylistId = playlist?.id ?? null;
        this.render();
      });
    }, "choir-small-button");
    this.textButton(actions, "save", "Queue", "Make playlist from queue", () => {
      this.plugin.openPlaylistModal("Save queue as playlist", `Queue ${new Date().toLocaleDateString()}`, (name) => {
        const playlist = this.plugin.createPlaylistFromQueue(name);
        this.selectedPlaylistId = playlist?.id ?? null;
        this.render();
      });
    }, "choir-small-button", this.plugin.data.queue.length === 0);

    if (this.plugin.data.playlists.length === 0) {
      this.renderEmpty(parent, "No playlists yet", "Save the current queue or create an empty playlist.");
      return;
    }

    const list = parent.createDiv({ cls: "choir-playlist-list" });
    for (const playlist of this.plugin.data.playlists) {
      const row = list.createDiv({ cls: "choir-playlist-row" });
      row.addEventListener("click", () => {
        void this.plugin.playPlaylist(playlist.id);
      });
      this.renderCover(row, playlist.trackPaths[0] ?? null, "choir-playlist-cover");
      const info = row.createDiv({ cls: "choir-playlist-info" });
      info.createDiv({ cls: "choir-playlist-title", text: playlist.name });
      info.createDiv({ cls: "choir-playlist-subtitle", text: plural(playlist.trackPaths.length, "track") });

      const rowActions = row.createDiv({ cls: "choir-track-actions" });
      this.iconButton(rowActions, "list", "Open playlist", () => {
        this.selectedPlaylistId = playlist.id;
        this.render();
      });
      this.iconButton(rowActions, "list-plus", "Add playlist to queue", () => this.plugin.enqueuePlaylist(playlist.id), playlist.trackPaths.length === 0);
      this.iconButton(rowActions, "trash-2", "Delete playlist", () => {
        this.plugin.deletePlaylist(playlist.id);
        this.selectedPlaylistId = null;
      });
    }
  }

  private renderPlaylistDetail(parent: HTMLElement, playlist: ChoirPlaylist): void {
    const toolbar = parent.createDiv({ cls: "choir-section-toolbar choir-section-toolbar-stacked" });
    const top = toolbar.createDiv({ cls: "choir-detail-top" });
    this.iconButton(top, "arrow-left", "Back to playlists", () => {
      this.selectedPlaylistId = null;
      this.render();
    });
    const title = top.createDiv({ cls: "choir-playlist-heading" });
    title.createDiv({ cls: "choir-section-title", text: playlist.name });
    title.createDiv({ cls: "choir-playlist-subtitle", text: plural(playlist.trackPaths.length, "track") });

    const actions = toolbar.createDiv({ cls: "choir-inline-actions" });
    this.textButton(actions, "list-plus", "Queue", "Add playlist to queue", () => this.plugin.enqueuePlaylist(playlist.id), "choir-small-button", playlist.trackPaths.length === 0);
    this.textButton(actions, "trash-2", "Delete", "Delete playlist", () => {
      this.plugin.deletePlaylist(playlist.id);
      this.selectedPlaylistId = null;
      this.render();
    }, "choir-small-button");

    if (playlist.trackPaths.length === 0) {
      this.renderEmpty(parent, "Playlist is empty", "Add songs from the Library track menu.");
      return;
    }

    const list = parent.createDiv({ cls: "choir-track-list" });
    playlist.trackPaths.forEach((path, index) => {
      const display = this.plugin.getTrackDisplay(path);
      const isCurrent = this.plugin.getCurrentPath() === path;
      const row = list.createDiv({ cls: `choir-track-row choir-playable-row${isCurrent ? " is-current" : ""}${display.missing ? " is-missing" : ""}` });
      row.dataset.choirPath = path;
      row.addEventListener("click", () => {
        if (!display.missing) void this.plugin.playPathList(playlist.trackPaths, index);
      });
      row.createDiv({ cls: "choir-track-number", text: `${index + 1}` });
      this.renderCover(row, path, "choir-track-cover");

      const meta = row.createDiv({ cls: "choir-track-meta" });
      meta.createDiv({ cls: "choir-track-title", text: display.title });
      meta.createDiv({ cls: "choir-track-subtitle", text: display.subtitle });

      const rowActions = row.createDiv({ cls: "choir-track-actions" });
      this.iconButton(rowActions, "trash-2", "Remove from playlist", () => this.plugin.removeFromPlaylist(playlist.id, index));
    });
  }

  private renderPlayer(parent: HTMLElement): void {
    const player = parent.createDiv({ cls: "choir-player" });
    this.playerEl = player;
    this.renderPlayerContents(player);
  }

  private renderPlayerContents(player: HTMLElement): void {
    const currentPath = this.plugin.getCurrentPath();
    const current = currentPath ? this.plugin.getTrackDisplay(currentPath) : null;

    const now = player.createDiv({ cls: "choir-now-playing" });
    this.renderCover(now, currentPath, "choir-now-cover");
    const details = now.createDiv({ cls: "choir-now-details" });
    details.createDiv({ cls: "choir-now-title", text: current?.title ?? "Nothing playing" });
    details.createDiv({ cls: "choir-now-subtitle", text: current?.subtitle ?? "Search the vault library to start" });

    const progressWrap = player.createDiv({ cls: "choir-progress-wrap" });
    this.elapsedEl = progressWrap.createSpan({ cls: "choir-time", text: "0:00" });
    this.progressEl = progressWrap.createEl("input", { cls: "choir-progress" });
    this.progressEl.type = "range";
    this.progressEl.min = "0";
    this.progressEl.step = "0.1";
    this.progressEl.addEventListener("input", () => {
      if (!this.progressEl) return;
      this.plugin.audio.currentTime = Number(this.progressEl.value);
      this.updateProgress();
    });
    this.durationEl = progressWrap.createSpan({ cls: "choir-time", text: "0:00" });

    const controls = player.createDiv({ cls: "choir-controls" });
    this.iconButton(controls, "shuffle", "Shuffle", () => this.plugin.toggleShuffle(), false, this.plugin.data.shuffle ? "is-active" : "");
    this.iconButton(controls, "skip-back", "Previous", () => {
      void this.plugin.playPreviousManual();
    });
    this.playButtonEl = this.iconButton(controls, this.plugin.audio.paused ? "play" : "pause", this.plugin.audio.paused ? "Play" : "Pause", () => {
      void this.plugin.togglePlay();
    }, false, "choir-primary-control");
    this.iconButton(controls, "skip-forward", "Next", () => {
      void this.plugin.playNextManual();
    });
    this.iconButton(
      controls,
      this.plugin.data.repeatMode === "one" ? "repeat-1" : "repeat",
      `Repeat: ${this.plugin.data.repeatMode}`,
      () => this.plugin.cycleRepeatMode(),
      false,
      this.plugin.data.repeatMode !== "off" ? "is-active" : "",
    );

    const volume = player.createDiv({ cls: "choir-volume" });
    this.volumeButtonEl = this.iconButton(volume, "volume-2", "Mute", () => this.plugin.toggleMute(), false, "choir-volume-mute");
    this.volumeEl = volume.createEl("input", { cls: "choir-volume-slider" });
    this.volumeEl.type = "range";
    this.volumeEl.min = "0";
    this.volumeEl.max = "100";
    this.volumeEl.step = "1";
    this.volumeEl.value = `${Math.round(this.plugin.data.volume * 100)}`;
    this.volumeEl.addEventListener("input", () => {
      if (!this.volumeEl) return;
      this.plugin.setVolume(Number(this.volumeEl.value) / 100);
    });
  }

  private renderEmpty(parent: HTMLElement, title: string, description: string): void {
    const empty = parent.createDiv({ cls: "choir-empty" });
    const icon = empty.createDiv({ cls: "choir-empty-icon" });
    setIcon(icon, "music");
    empty.createDiv({ cls: "choir-empty-title", text: title });
    empty.createDiv({ cls: "choir-empty-description", text: description });
  }

  private openTrackMenu(event: MouseEvent, file: TFile): void {
    const menu = new Menu();
    menu.addItem((item) => item
      .setTitle("Play now")
      .setIcon("play")
      .onClick(() => {
        void this.plugin.playPath(file.path);
      }));
    menu.addItem((item) => item
      .setTitle("Play next")
      .setIcon("list-start")
      .onClick(() => this.plugin.playNext(file.path)));
    menu.addItem((item) => item
      .setTitle("Add to queue")
      .setIcon("list-plus")
      .onClick(() => this.plugin.addToQueue(file.path)));

    if (this.plugin.data.playlists.length > 0) {
      menu.addSeparator();
      for (const playlist of this.plugin.data.playlists) {
        menu.addItem((item) => item
          .setTitle(`Add to ${playlist.name}`)
          .setIcon("plus")
          .onClick(() => this.plugin.addToPlaylist(playlist.id, file.path)));
      }
    } else {
      menu.addSeparator();
      menu.addItem((item) => item
        .setTitle("Create playlist from queue")
        .setIcon("save")
        .onClick(() => {
          this.plugin.openPlaylistModal("Save queue as playlist", `Queue ${new Date().toLocaleDateString()}`, (name) => {
            this.plugin.createPlaylistFromQueue(name);
          });
        }));
    }

    menu.showAtMouseEvent(event);
  }

  private iconButton(
    parent: HTMLElement,
    iconId: string,
    title: string,
    onClick: (event: MouseEvent) => void,
    disabled = false,
    extraClass = "",
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: `choir-icon-button${extraClass ? ` ${extraClass}` : ""}`,
      attr: { type: "button", title, "aria-label": title },
    });
    button.disabled = disabled;
    setIcon(button, iconId);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!button.disabled) onClick(event);
    });
    return button;
  }

  private textButton(
    parent: HTMLElement,
    iconId: string,
    label: string,
    title: string,
    onClick: () => void,
    extraClass = "",
    disabled = false,
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      cls: `choir-text-button${extraClass ? ` ${extraClass}` : ""}`,
      attr: { type: "button", title, "aria-label": title },
    });
    button.disabled = disabled;
    const icon = button.createSpan({ cls: "choir-text-button-icon" });
    setIcon(icon, iconId);
    button.createSpan({ cls: "choir-text-button-label", text: label });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!button.disabled) onClick();
    });
    return button;
  }
}

class ChoirAudioFileView extends FileView {
  constructor(leaf: WorkspaceLeaf, private readonly plugin: ChoirPlugin) {
    super(leaf);
    this.icon = "music";
  }

  getViewType(): string {
    return VIEW_TYPE_CHOIR_AUDIO_FILE;
  }

  getDisplayText(): string {
    return this.file ? `Choir: ${this.file.basename}` : "Choir audio";
  }

  async onLoadFile(file: TFile): Promise<void> {
    if (!this.plugin.data.settings.interceptAudioClicks) {
      this.render(file, "Automatic audio file playback is disabled in Choir settings.");
      return;
    }

    await this.plugin.playAudioFile(file);
    this.render(file);
  }

  async onUnloadFile(): Promise<void> {
    return;
  }

  private render(file: TFile, description = "Playing in the Choir sidebar."): void {
    this.contentEl.empty();
    this.contentEl.addClass("choir-file-view");

    const wrap = this.contentEl.createDiv({ cls: "choir-file-card" });
    const icon = wrap.createDiv({ cls: "choir-file-icon" });
    setIcon(icon, "panel-right-open");
    wrap.createDiv({ cls: "choir-file-title", text: file.basename });
    wrap.createDiv({ cls: "choir-file-desc", text: description });

    const actions = wrap.createDiv({ cls: "choir-file-actions" });
    const openButton = actions.createEl("button", {
      cls: "choir-text-button",
      attr: { type: "button" },
    });
    const openIcon = openButton.createSpan({ cls: "choir-text-button-icon" });
    setIcon(openIcon, "music");
    openButton.createSpan({ cls: "choir-text-button-label", text: "Open Choir" });
    openButton.addEventListener("click", () => {
      void this.plugin.activateView();
    });
  }
}

class PlaylistNameModal extends Modal {
  constructor(
    app: App,
    private readonly modalTitle: string,
    private readonly defaultName: string,
    private readonly onSubmitName: (name: string) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.modalTitle);
    this.contentEl.empty();

    const form = this.contentEl.createEl("form", { cls: "choir-modal-form" });
    const input = form.createEl("input", { cls: "choir-modal-input" });
    input.type = "text";
    input.placeholder = "Playlist name";
    input.value = this.defaultName;

    const actions = form.createDiv({ cls: "choir-modal-actions" });
    const cancel = actions.createEl("button", {
      cls: "choir-text-button",
      text: "Cancel",
      attr: { type: "button" },
    });
    const create = actions.createEl("button", {
      cls: "choir-text-button mod-cta",
      text: "Save",
      attr: { type: "submit" },
    });

    cancel.addEventListener("click", () => this.close());
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) {
        new Notice("Playlist name is required.");
        return;
      }
      this.onSubmitName(name);
      this.close();
    });

    input.focus();
    input.select();
    create.focus();
    input.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

class ChoirSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ChoirPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const { settings } = this.plugin.data;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Choir" });

    containerEl.createEl("h3", { text: "Library" });

    new Setting(containerEl)
      .setName("Supported audio files")
      .setDesc(AUDIO_EXTENSIONS.map((extension) => `.${extension}`).join(", "));

    new Setting(containerEl)
      .setName("Vault music scan")
      .setDesc(`${plural(this.plugin.library.length, "track")} currently indexed.`)
      .addButton((button) => button
        .setButtonText("Scan now")
        .onClick(() => {
          this.plugin.refreshLibrary();
          this.display();
        }));

    new Setting(containerEl)
      .setName("Music folders")
      .setDesc("Optional vault folders to scan. Leave empty to scan the whole vault.")
      .addTextArea((text) => {
        text
          .setPlaceholder("Music\nAudio/Albums")
          .setValue(settings.musicFolders.join("\n"))
          .onChange((value) => this.plugin.updateSettings({ musicFolders: sanitizeFolderList(value) }, true));
        text.inputEl.rows = 3;
      });

    new Setting(containerEl)
      .setName("Excluded folders")
      .setDesc("Folders Choir should ignore even when they contain audio files.")
      .addTextArea((text) => {
        text
          .setPlaceholder("Archive/Old music\nAudio/Voice memos")
          .setValue(settings.excludedFolders.join("\n"))
          .onChange((value) => this.plugin.updateSettings({ excludedFolders: sanitizeFolderList(value) }, true));
        text.inputEl.rows = 3;
      });

    new Setting(containerEl)
      .setName("Intercept audio file clicks")
      .setDesc("Automatically play and reveal Choir when supported audio files are opened.")
      .addToggle((toggle) => toggle
        .setValue(settings.interceptAudioClicks)
        .onChange((value) => this.plugin.updateSettings({ interceptAudioClicks: value })));

    new Setting(containerEl)
      .setName("Audio file open behavior")
      .setDesc("Choose what happens when an audio file is opened from Obsidian.")
      .addDropdown((dropdown) => dropdown
        .addOption("single", "Play only that song")
        .addOption("folder", "Queue that song's folder")
        .setValue(settings.audioFileOpenMode)
        .onChange((value) => {
          if (isAudioFileOpenMode(value)) this.plugin.updateSettings({ audioFileOpenMode: value });
        }));

    containerEl.createEl("h3", { text: "Playback" });

    new Setting(containerEl)
      .setName("Volume")
      .setDesc("Default and current player volume.")
      .addSlider((slider) => slider
        .setLimits(0, 100, 1)
        .setValue(Math.round(this.plugin.data.volume * 100))
        .setDynamicTooltip()
        .onChange((value) => this.plugin.setVolume(value / 100)));

    new Setting(containerEl)
      .setName("Shuffle")
      .setDesc("Keep shuffle enabled until you turn it off.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.data.shuffle)
        .onChange((value) => this.plugin.setShuffle(value)));

    new Setting(containerEl)
      .setName("Repeat")
      .setDesc("Saved repeat mode for the player controls.")
      .addDropdown((dropdown) => dropdown
        .addOption("off", "Off")
        .addOption("all", "All")
        .addOption("one", "One")
        .setValue(this.plugin.data.repeatMode)
        .onChange((value) => {
          if (isRepeatMode(value)) this.plugin.setRepeatMode(value);
        }));

    new Setting(containerEl)
      .setName("Remember queue")
      .setDesc("Restore the current queue after Obsidian restarts.")
      .addToggle((toggle) => toggle
        .setValue(settings.rememberQueue)
        .onChange((value) => this.plugin.updateSettings({ rememberQueue: value })));

    new Setting(containerEl)
      .setName("Recent history limit")
      .setDesc("Maximum tracks kept in Recently played.")
      .addSlider((slider) => slider
        .setLimits(MIN_RECENT_LIMIT, MAX_RECENT_LIMIT, 10)
        .setValue(settings.recentLimit)
        .setDynamicTooltip()
        .onChange((value) => this.plugin.updateSettings({ recentLimit: value })));

    new Setting(containerEl)
      .setName("Status bar now playing")
      .setDesc("Show a compact now-playing item in Obsidian's bottom status bar.")
      .addToggle((toggle) => toggle
        .setValue(settings.showStatusBar)
        .onChange((value) => this.plugin.updateSettings({ showStatusBar: value })));

    containerEl.createEl("h3", { text: "Appearance" });

    new Setting(containerEl)
      .setName("Color theme")
      .setDesc("Use cover art colors, or keep Choir on Obsidian's accent color.")
      .addDropdown((dropdown) => dropdown
        .addOption("cover", "Cover art")
        .addOption("obsidian", "Obsidian accent")
        .setValue(settings.themeMode)
        .onChange((value) => {
          if (isThemeMode(value)) this.plugin.updateSettings({ themeMode: value });
        }));

    new Setting(containerEl)
      .setName("Cover color strength")
      .setDesc("Controls how strongly cover art recolors the player.")
      .addSlider((slider) => slider
        .setLimits(0, 100, 5)
        .setValue(Math.round(settings.themeIntensity * 100))
        .setDynamicTooltip()
        .onChange((value) => this.plugin.updateSettings({ themeIntensity: value / 100 })));

    new Setting(containerEl)
      .setName("Layout density")
      .setDesc("Compact mode fits more tracks in the sidebar.")
      .addDropdown((dropdown) => dropdown
        .addOption("comfortable", "Comfortable")
        .addOption("compact", "Compact")
        .setValue(settings.density)
        .onChange((value) => {
          if (isDensityMode(value)) this.plugin.updateSettings({ density: value });
        }));

    new Setting(containerEl)
      .setName("Row action buttons")
      .setDesc("Show queue/menu buttons on hover or keep them visible.")
      .addDropdown((dropdown) => dropdown
        .addOption("hover", "On hover")
        .addOption("always", "Always visible")
        .setValue(settings.rowActions)
        .onChange((value) => {
          if (isRowActionVisibility(value)) this.plugin.updateSettings({ rowActions: value });
        }));

    new Setting(containerEl)
      .setName("Sidebar tab order")
      .setDesc("Drag Music, Artists, Recent, Queue, and Lists into your preferred sequence.")
      .addButton((button) => button
        .setButtonText("Reset")
        .onClick(() => {
          this.plugin.updateSettings({ tabOrder: DEFAULT_TAB_ORDER });
          this.display();
        }));
    this.renderTabOrderEditor(containerEl);

    new Setting(containerEl)
      .setName("Track numbers")
      .setDesc("Show list position numbers beside tracks.")
      .addToggle((toggle) => toggle
        .setValue(settings.showTrackNumbers)
        .onChange((value) => this.plugin.updateSettings({ showTrackNumbers: value })));

    new Setting(containerEl)
      .setName("Cover thumbnails")
      .setDesc("Show embedded cover art in lists and the mini player.")
      .addToggle((toggle) => toggle
        .setValue(settings.showCovers)
        .onChange((value) => this.plugin.updateSettings({ showCovers: value })));

    new Setting(containerEl)
      .setName("Reset appearance")
      .setDesc("Restore Choir's visual settings to the defaults.")
      .addButton((button) => button
        .setButtonText("Reset")
        .onClick(() => {
          this.plugin.resetAppearanceSettings();
          this.display();
        }));

    containerEl.createEl("h3", { text: "Data" });

    new Setting(containerEl)
      .setName("Saved queue")
      .setDesc(`${plural(this.plugin.data.queue.length, "track")} in the current queue.`)
      .addButton((button) => button
        .setButtonText("Clear queue")
        .setWarning()
        .setDisabled(this.plugin.data.queue.length === 0)
        .onClick(() => {
          this.plugin.clearQueue();
          this.display();
        }));

    new Setting(containerEl)
      .setName("Recently played")
      .setDesc(`${plural(this.plugin.data.recentlyPlayed.length, "track")} saved in history.`)
      .addButton((button) => button
        .setButtonText("Clear history")
        .setWarning()
        .setDisabled(this.plugin.data.recentlyPlayed.length === 0)
        .onClick(() => {
          this.plugin.clearRecentlyPlayed();
          this.display();
        }));
  }

  private renderTabOrderEditor(containerEl: HTMLElement): void {
    const list = containerEl.createDiv({ cls: "choir-settings-tab-order" });
    let draggedTab: ChoirTab | null = null;

    for (const tab of this.plugin.data.settings.tabOrder) {
      const config = TAB_CONFIG[tab];
      const row = list.createDiv({ cls: "choir-settings-tab-row", attr: { draggable: "true" } });
      row.dataset.choirTab = tab;

      const grip = row.createSpan({ cls: "choir-settings-tab-grip" });
      setIcon(grip, "grip-vertical");
      const icon = row.createSpan({ cls: "choir-settings-tab-icon" });
      setIcon(icon, config.icon);
      row.createSpan({ cls: "choir-settings-tab-label", text: config.label });

      row.addEventListener("dragstart", (event) => {
        draggedTab = tab;
        row.addClass("is-dragging");
        event.dataTransfer?.setData("text/plain", tab);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      });

      row.addEventListener("dragover", (event) => {
        event.preventDefault();
        const placeAfter = event.clientY > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
        row.toggleClass("is-drop-before", !placeAfter);
        row.toggleClass("is-drop-after", placeAfter);
      });

      row.addEventListener("dragleave", () => {
        row.removeClass("is-drop-before");
        row.removeClass("is-drop-after");
      });

      row.addEventListener("drop", (event) => {
        event.preventDefault();
        const source = draggedTab ?? event.dataTransfer?.getData("text/plain") ?? "";
        row.removeClass("is-drop-before");
        row.removeClass("is-drop-after");
        if (!isChoirTab(source) || source === tab) return;

        const placeAfter = event.clientY > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
        this.plugin.updateSettings({
          tabOrder: moveTabInOrder(this.plugin.data.settings.tabOrder, source, tab, placeAfter),
        });
        this.display();
      });

      row.addEventListener("dragend", () => {
        draggedTab = null;
        list.querySelectorAll(".choir-settings-tab-row").forEach((item) => {
          item.removeClass("is-dragging");
          item.removeClass("is-drop-before");
          item.removeClass("is-drop-after");
        });
      });
    }
  }
}
