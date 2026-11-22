import { describe, expect, it, vi } from 'vitest';

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
    vi.doMock('react-native', () => ({ Platform: { OS: 'ios' } }));
    vi.doMock('expo-sharing', () => ({ isAvailableAsync: async () => true, shareAsync }));
    vi.doMock('expo-file-system', () => ({ File, Paths: { cache: 'file:///cache/' } }));
    vi.doMock('@/shared/protocol/opencode/client/fetch', () => ({ fetchConnection }));
    const { saveOrShareProjectFile } = await import('@/features/projects/services/project-file-download');
    const url = 'https://server.test/api/fs/read/archive.zip';
    const settings = { serverUrl: 'https://server.test', oidc: { issuer: 'https://login.test' } };

    await saveOrShareProjectFile({ url, oidcConnection: settings as Parameters<typeof saveOrShareProjectFile>[0]['oidcConnection'], filename: 'archive.zip', mime: 'application/zip' });

    expect(fetchConnection).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: 'error' }), settings, undefined, expect.any(Number));
    expect(downloadFileAsync).not.toHaveBeenCalled();
    expect(chunks).toEqual([1, 2, 3]);
    expect(shareAsync).toHaveBeenCalledOnce();
    expect(deleteFile).toHaveBeenCalledOnce();
  });
});
