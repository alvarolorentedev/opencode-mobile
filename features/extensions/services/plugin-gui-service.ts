import { createPrefixFetch, getRequestHeaders } from '@/shared/protocol/opencode/client/fetch';
import type { OpencodeConnectionSettings } from '@/shared/protocol/opencode/client';
import { resolveV2Base } from '@/shared/protocol/opencode/v2/shared';
import type { PluginGuiBundle } from '@/features/extensions/model/plugin-gui';

type GuiResponse = {
  data?: Partial<PluginGuiBundle>;
};

const MAX_GUI_BYTES = 8_000_000;

/**
 * Reads one plugin's prebuilt GUI bundle from the connected server.
 *
 * The endpoint is newer than the typed client shipped with the app, so this
 * uses the app's authenticated fetch pipeline instead of the generated client.
 */
export async function readPluginGui(
  settings: OpencodeConnectionSettings,
  id: string,
  signal?: AbortSignal,
): Promise<PluginGuiBundle> {
  const { base, pathPrefix } = resolveV2Base(settings);
  const request = createPrefixFetch(base.origin, pathPrefix, settings, signal);
  const url = new URL('/api/plugin/gui', base.origin);
  url.searchParams.set('id', id);
  if (settings.directory) url.searchParams.set('location[directory]', settings.directory);

  const response = await request(url.toString(), {
    method: 'GET',
    // This endpoint bypasses the generated SDK, so it must reuse the same
    // Basic/custom headers as every other connection request.
    headers: { ...(getRequestHeaders(settings) ?? {}), accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Could not read the plugin GUI (${response.status}).`);
  }

  const body = (await response.json()) as GuiResponse;
  const code = body.data?.code;
  if (typeof code !== 'string' || !code) {
    throw new Error('The server returned an empty plugin GUI bundle.');
  }
  if (code.length > MAX_GUI_BYTES) {
    throw new Error('This plugin GUI is too large for the mobile host.');
  }

  return {
    code,
    revision: typeof body.data?.revision === 'string' ? body.data.revision : '',
    options: body.data?.options && typeof body.data.options === 'object' ? body.data.options : {},
  };
}
