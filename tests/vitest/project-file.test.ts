import { describe, expect, it } from 'vitest';

import {
  MAX_PROJECT_PREVIEW_BYTES,
  knownProjectFileKind,
  projectFileFromBytes,
  projectFileFromText,
  projectFileFromV1Content,
  projectFileMime,
  projectFileWithoutContent,
} from '@/lib/opencode/project-file';

const bytes = (value: string) => new TextEncoder().encode(value);

describe('project file normalization', () => {
  it('detects preview kinds and MIME types from the path', () => {
    expect(projectFileMime('assets/Logo.PNG')).toBe('image/png');
    expect(projectFileMime('src/app.tsx')).toBe('text/plain');
    expect(projectFileMime('dist/app.apk')).toBe('application/vnd.android.package-archive');
    expect(projectFileMime('unknown.asset')).toBe('application/octet-stream');
    expect(knownProjectFileKind('assets/logo.png')).toBe('image');
    expect(knownProjectFileKind('assets/song.mp3')).toBe('audio');
    expect(knownProjectFileKind('assets/clip.mp4')).toBe('video');
    expect(knownProjectFileKind('dist/app.apk')).toBe('document');
    expect(knownProjectFileKind('src/icon.svg')).toBe('text');
    expect(knownProjectFileKind('src/main.unknown')).toBeUndefined();
  });

  it('keeps text editable and previews inline media bytes', () => {
    const text = projectFileFromBytes('src/main.ts', bytes('export const value = 1;\n'));
    expect(text).toMatchObject({ kind: 'text', mime: 'text/plain', canDownload: true });
    expect(text.content).toEqual({ type: 'text', content: 'export const value = 1;\n' });
    expect(text.bytes).toBeUndefined();

    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const image = projectFileFromBytes('assets/logo.png', imageBytes);
    expect(image).toMatchObject({ kind: 'image', mime: 'image/png', size: 4, canDownload: true });
    expect(image.bytes).toBe(imageBytes);

    const document = projectFileFromBytes('assets/archive.zip', bytes('PK'));
    expect(document).toMatchObject({ kind: 'document', bytes: undefined, canDownload: true });
  });

  it('does not retain oversized media or invalid text bytes', () => {
    const oversized = projectFileFromBytes('assets/huge.png', new Uint8Array(MAX_PROJECT_PREVIEW_BYTES + 1));
    expect(oversized.kind).toBe('image');
    expect(oversized.bytes).toBeUndefined();
    expect(oversized.size).toBe(MAX_PROJECT_PREVIEW_BYTES + 1);

    const invalid = projectFileFromBytes('src/not-text.ts', new Uint8Array([0xff, 0xfe]));
    expect(invalid).toMatchObject({ kind: 'document', canDownload: true });
    expect(invalid.bytes).toBeUndefined();
  });

  it('normalizes text saves and V1 binary limitations', () => {
    const text = projectFileFromText('README.md', { type: 'text', content: '# Hello\n' });
    expect(text).toMatchObject({ kind: 'text', mime: 'text/markdown', size: 8, canDownload: true });
    expect(projectFileFromText('src/icon.svg', { type: 'text', content: '<svg />' })).toMatchObject({ kind: 'text', mime: 'image/svg+xml' });

    const v1Text = projectFileFromV1Content('README.md', { type: 'text', content: '# Hello\n' });
    expect(v1Text).toMatchObject({ kind: 'text', canDownload: true });

    const v1Image = projectFileFromV1Content('assets/logo.png', { type: 'binary', content: '' });
    expect(v1Image).toMatchObject({ kind: 'image', canDownload: false });
    expect(v1Image.bytes).toBeUndefined();

    const document = projectFileWithoutContent('dist/app.apk', false);
    expect(document).toMatchObject({ kind: 'document', canDownload: false });
  });
});
