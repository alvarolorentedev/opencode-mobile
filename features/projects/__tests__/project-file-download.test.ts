import { describe, expect, it, vi } from 'vitest';
import { loadTs } from '../../../tests/helpers/runtime.mjs';

describe('authenticated project file downloads', () => {
  it('streams the protected response to a native file and removes it after sharing', async () => {
    const chunks: number[] = [];
    const deleteFile = vi.fn();
    const shareAsync = vi.fn(async () => {});
    const downloadFileAsync = vi.fn();
    const fetchConnection = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    class File {
      static downloadFileAsync = downloadFileAsync;
      readonly uri = 'file:///cache/archive.zip';
      exists = false;
      create() { this.exists = true; }
      delete() { deleteFile(); }
      writableStream() {
        return new WritableStream<Uint8Array>({ write(chunk) { chunks.push(...chunk); } });
      }
    }
    const { saveOrShareProjectFile } = await loadTs('features/projects/services/project-file-download.ts', {
      'react-native': { Platform: { OS: 'ios' } },
      'expo-sharing': { isAvailableAsync: async () => true, shareAsync },
      'expo-file-system': { File, Paths: { cache: 'file:///cache/' } },
      '@/shared/protocol/opencode/client/fetch': { fetchConnection },
    });
    const url = 'https://server.test/api/fs/read/archive.zip';
    const settings = { serverUrl: 'https://server.test', oidc: { issuer: 'https://login.test' } };

    await saveOrShareProjectFile({ url, oidcConnection: settings, filename: 'archive.zip', mime: 'application/zip' });

    expect(fetchConnection).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: 'error' }), settings, undefined, expect.any(Number));
    expect(downloadFileAsync).not.toHaveBeenCalled();
    expect(chunks).toEqual([1, 2, 3]);
    expect(shareAsync).toHaveBeenCalledOnce();
    expect(deleteFile).toHaveBeenCalledOnce();
  });
});
