export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  status: number;
}

export async function postJson<T>(
  url: string,
  payload: unknown,
  timeoutMs = 50_000
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const rawText = await response.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const serverMsg =
        parsed && typeof parsed.error === 'string'
          ? parsed.error
          : response.status === 504
          ? 'The AI request timed out before finishing. Please try again.'
          : response.status === 502 || response.status === 503
          ? 'The Echo backend server is restarting or temporarily unavailable. Please retry in a moment.'
          : `Server returned HTTP ${response.status}. Please try again.`;
      return { ok: false, error: serverMsg, status: response.status };
    }

    if (!parsed) {
      return {
        ok: false,
        error: 'Received an unexpected non-JSON response from the server. Please retry.',
        status: response.status,
      };
    }

    return { ok: true, data: parsed as unknown as T, status: response.status };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return {
        ok: false,
        error: 'The AI service took too long to respond. Please retry.',
        status: 408,
      };
    }
    return {
      ok: false,
      error: 'Could not reach the Echo server. Check your internet connection and retry.',
      status: 0,
    };
  } finally {
    window.clearTimeout(timer);
  }
}
