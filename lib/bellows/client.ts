/**
 * Bellows API Client
 *
 * Directly calls the LiteLLM proxy endpoints (OpenAI-compatible API on port 4000).
 * Runs in parallel to the existing @opencode-ai/sdk client as an alternative backend.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BellowsConnectionSettings = {
  serverUrl: string;
  apiKey: string;
};

export const defaultBellowsSettings: BellowsConnectionSettings = {
  serverUrl: 'http://127.0.0.1:4000',
  apiKey: 'sk-anvil-safe-key',
};

export type BellowsBudgetInfo = {
  current_spend: number;
  max_budget: number | null;
};

export type BellowsModel = {
  id: string;
  [key: string]: any;
};

export type BellowsChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type BellowsChatCompletionParams = {
  model: string;
  messages: BellowsChatMessage[];
  max_tokens?: number;
};

export type BellowsChatCompletionResponse = {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: BellowsChatMessage;
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildUrl(settings: BellowsConnectionSettings, path: string): string {
  const base = settings.serverUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

function buildHeaders(settings: BellowsConnectionSettings): Record<string, string> {
  return {
    'Authorization': `Bearer ${settings.apiKey}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
}

async function bellowsRequest<T>(
  settings: BellowsConnectionSettings,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = buildUrl(settings, path);
  const response = await fetch(url, {
    ...init,
    headers: {
      ...buildHeaders(settings),
      ...(init?.headers as Record<string, string> || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Bellows request failed (${response.status}): ${text || response.statusText}`);
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Public API functions
// ---------------------------------------------------------------------------

/**
 * POST /v1/chat/completions - OpenAI-compatible chat completion
 */
export async function bellowsChatCompletion(
  settings: BellowsConnectionSettings,
  params: BellowsChatCompletionParams,
): Promise<BellowsChatCompletionResponse> {
  return bellowsRequest<BellowsChatCompletionResponse>(settings, '/v1/chat/completions', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/**
 * GET /model/list - List available models on the proxy
 */
export async function bellowsListModels(
  settings: BellowsConnectionSettings,
): Promise<BellowsModel[]> {
  const response = await bellowsRequest<{ data?: BellowsModel[] } | BellowsModel[]>(settings, '/model/list');
  if (Array.isArray(response)) {
    return response;
  }
  return response?.data ?? [];
}

/**
 * POST /model/add - Add a model to the proxy
 */
export async function bellowsAddModel(
  settings: BellowsConnectionSettings,
  params: Record<string, unknown>,
): Promise<unknown> {
  return bellowsRequest<unknown>(settings, '/model/add', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/**
 * GET /budget/info - Retrieve budget usage information
 *
 * Normalizes the response shape to handle LiteLLM version differences.
 * Some versions nest data under `info`, `budget_info`, or return fields at root level.
 */
export async function bellowsBudgetInfo(
  settings: BellowsConnectionSettings,
): Promise<BellowsBudgetInfo> {
  const response = await bellowsRequest<Record<string, unknown>>(settings, '/budget/info');

  // Normalize: LiteLLM may nest budget data under different keys
  const data = (response as Record<string, unknown>).info
    ?? (response as Record<string, unknown>).budget_info
    ?? response;

  const record = data as Record<string, unknown>;
  return {
    current_spend: typeof record.current_spend === 'number' ? record.current_spend : 0,
    max_budget: typeof record.max_budget === 'number' ? record.max_budget : null,
  };
}

/**
 * GET /spend/total - Retrieve total spend amount
 */
export async function bellowsSpendTotal(
  settings: BellowsConnectionSettings,
): Promise<unknown> {
  return bellowsRequest<unknown>(settings, '/spend/total');
}

/**
 * GET /spend/logs - Retrieve spending logs
 */
export async function bellowsSpendLogs(
  settings: BellowsConnectionSettings,
): Promise<unknown> {
  return bellowsRequest<unknown>(settings, '/spend/logs');
}

/**
 * GET /cache/info - Retrieve cache statistics
 */
export async function bellowsCacheInfo(
  settings: BellowsConnectionSettings,
): Promise<unknown> {
  return bellowsRequest<unknown>(settings, '/cache/info');
}
