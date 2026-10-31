import type { FileContent } from '@/shared/protocol/opencode/types';

// Chat attachments are limited to 10 MB because they are sent to the model.
// Project files are only displayed or downloaded, so allow a larger inline
// preview while keeping the bytes bounded on lower-memory devices. Larger
// files still download through the streaming path.
import { MAX_PROJECT_PREVIEW_BYTES } from '@/shared/contracts/project-preview';

export type ProjectFileKind = 'text' | 'image' | 'audio' | 'video' | 'document';

export type ProjectFile = {
  path: string;
  kind: ProjectFileKind;
  mime: string;
  size?: number;
  content: FileContent;
  bytes?: Uint8Array;
  canDownload: boolean;
};

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  ogv: 'video/ogg',
  pdf: 'application/pdf',
  zip: 'application/zip',
  apk: 'application/vnd.android.package-archive',
  ipa: 'application/x-ios-app',
  jar: 'application/java-archive',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  tgz: 'application/gzip',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  jsonc: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  scss: 'text/x-scss',
  less: 'text/x-less',
  js: 'text/javascript',
  jsx: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  ts: 'text/plain',
  tsx: 'text/plain',
  py: 'text/x-python',
  rb: 'text/x-ruby',
  go: 'text/x-go',
  rs: 'text/x-rust',
  java: 'text/x-java-source',
  kt: 'text/x-kotlin',
  swift: 'text/x-swift',
  c: 'text/x-c',
  h: 'text/x-c',
  cpp: 'text/x-c++',
  hpp: 'text/x-c++',
  cs: 'text/x-csharp',
  php: 'text/x-php',
  sh: 'text/x-shellscript',
  bash: 'text/x-shellscript',
  zsh: 'text/x-shellscript',
  fish: 'text/x-shellscript',
  toml: 'text/plain',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  ini: 'text/plain',
  conf: 'text/plain',
  log: 'text/plain',
  sql: 'text/x-sql',
  graphql: 'text/plain',
  gql: 'text/plain',
};

const TEXT_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-yaml',
  'application/yaml',
]);

const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/zip',
  'application/vnd.android.package-archive',
  'application/x-ios-app',
  'application/java-archive',
  'application/x-tar',
  'application/gzip',
  'application/x-7z-compressed',
  'application/vnd.rar',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

export function projectFileMime(path: string) {
  const filename = path.split('/').pop() || path;
  const extension = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
  return MIME_BY_EXTENSION[extension] || 'application/octet-stream';
}

function isTextMime(mime: string) {
  return mime.startsWith('text/') || TEXT_MIME_TYPES.has(mime);
}

// Returns a definite kind only when the extension is enough to decide without
// reading the file. `undefined` means the server bytes must be inspected.
export function knownProjectFileKind(path: string): ProjectFileKind | undefined {
  const mime = projectFileMime(path);
  // SVG is editable markup and stays in the text editor.
  if (mime === 'image/svg+xml') return 'text';
  if (isTextMime(mime)) return 'text';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (DOCUMENT_MIME_TYPES.has(mime)) return 'document';
  return undefined;
}

export function binaryFileContent(): FileContent {
  return { type: 'binary', content: '', encoding: 'base64' };
}

function bytesOf(value: Uint8Array | string) {
  return typeof value === 'string' ? new TextEncoder().encode(value) : value;
}

function decodeText(bytes: Uint8Array) {
  try {
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return content.includes('\0') ? undefined : content;
  } catch {
    return undefined;
  }
}

export function projectFileFromBytes(path: string, value: Uint8Array | string): ProjectFile {
  const bytes = bytesOf(value);
  const mime = projectFileMime(path);
  const known = knownProjectFileKind(path);
  const size = bytes.byteLength;

  if (known && known !== 'text') {
    const previewable = known !== 'document' && size <= MAX_PROJECT_PREVIEW_BYTES;
    return { path, kind: known, mime, size, content: binaryFileContent(), bytes: previewable ? bytes : undefined, canDownload: true };
  }

  const text = decodeText(bytes);
  if (text !== undefined) {
    return {
      path,
      kind: 'text',
      mime: known === 'text' ? mime : 'text/plain',
      size,
      content: { type: 'text', content: text },
      canDownload: true,
    };
  }

  return { path, kind: 'document', mime: mime === 'application/octet-stream' ? 'application/octet-stream' : mime, size, content: binaryFileContent(), canDownload: true };
}

export function projectFileFromText(path: string, content: FileContent): ProjectFile {
  const mime = projectFileMime(path);
  return {
    path,
    kind: 'text',
    mime: isTextMime(mime) || mime === 'image/svg+xml' ? mime : 'text/plain',
    size: new TextEncoder().encode(content.content).byteLength,
    content: { ...content, type: 'text' },
    canDownload: true,
  };
}

export function projectFileWithoutContent(path: string, canDownload: boolean): ProjectFile {
  return { path, kind: 'document', mime: projectFileMime(path), content: binaryFileContent(), canDownload };
}

export function projectFileFromV1Content(path: string, content: FileContent): ProjectFile {
  if (content.type === 'text' && content.encoding !== 'base64') {
    return projectFileFromText(path, content);
  }
  const known = knownProjectFileKind(path);
  return {
    path,
    kind: known === 'text' ? 'document' : known || 'document',
    mime: projectFileMime(path),
    content: binaryFileContent(),
    canDownload: false,
  };
}

export function projectFileDownloadUrl({ origin, pathPrefix, directory, path }: {
  origin: string;
  pathPrefix: string;
  directory: string;
  path: string;
}) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const prefix = pathPrefix.replace(/\/api$/, '').replace(/\/$/, '');
  const url = new URL(`${origin}${prefix}/api/fs/read/${encodedPath}`);
  url.searchParams.set('location[directory]', directory);
  return url.toString();
}
