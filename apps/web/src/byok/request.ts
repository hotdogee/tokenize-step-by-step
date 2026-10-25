/**
 * The one HTTP path of the BYOK panels (05 §13): a manual POST from the browser straight to the provider, with
 * `credentials: 'omit'` (no cookies, no HTTP auth), no referrer, no cache and no redirects, under a timeout. The CSP's
 * `connect-src` admits only `'self'`, https://api.anthropic.com and https://api.x.ai (06 §6). The outcome is data — a
 * parsed JSON body or a `Failure` — and is never logged: nothing here writes to the console or to any storage.
 */

/** A request a panel sends (built by anthropic.ts / xai.ts; the header builders are unit-tested exactly). */
export interface ProviderRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  /** JSON text. */
  readonly body: string;
}

/** Why a call did not yield a usable answer (errors.ts maps it to the panel's message). */
export type Failure =
  | { readonly kind: 'http'; readonly status: number; readonly message: string | null }
  | { readonly kind: 'network' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'bad-response' };

export type CallOutcome =
  | { readonly ok: true; readonly json: unknown }
  | { readonly ok: false; readonly failure: Failure }
  /** The caller aborted (drawer collapsed, page hidden): no message, no result. */
  | { readonly ok: false; readonly aborted: true };

/** Seconds a provider may take before the panel gives up (the button is disabled while a request is pending). */
export const TIMEOUT_SECONDS = 30;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The provider's own error sentence from an error body: Anthropic `{ error: { message } }`, xAI `{ error: "…" }` or
 * `{ message }`; null when there is none. At most 300 characters.
 */
export function providerMessage(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const error = body['error'];
  let message: unknown = null;
  if (typeof error === 'string') message = error;
  else if (isRecord(error) && typeof error['message'] === 'string') message = error['message'];
  else if (typeof body['message'] === 'string') message = body['message'];
  if (typeof message !== 'string' || message.trim() === '') return null;
  const text = message.trim();
  return text.length > 300 ? `${text.slice(0, 299)}…` : text;
}

/** `text` with every occurrence of `secret` masked (a provider message never shows the key, even if it echoed it). */
export function redact(text: string, secret: string): string {
  return secret.length < 4 ? text : text.split(secret).join('•••');
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * POSTs `request` and reads the JSON answer. `signal` aborts it (the outcome is then `aborted`); after `timeoutMs` the
 * call settles as a `timeout` failure. A rejected `fetch` (DNS, offline, or a CORS refusal, which browsers do not
 * distinguish) is a `network` failure.
 */
export async function callProvider(
  request: ProviderRequest,
  signal: AbortSignal,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  timeoutMs: number = TIMEOUT_SECONDS * 1000,
): Promise<CallOutcome> {
  const controller = new AbortController();
  const timeout = { fired: false };
  const timer = setTimeout(() => {
    timeout.fired = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = (): void => {
    controller.abort();
  };
  if (signal.aborted) controller.abort();
  else signal.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetchImpl(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    const json = await readJson(response);
    if (signal.aborted) return { ok: false, aborted: true };
    if (!response.ok)
      return { ok: false, failure: { kind: 'http', status: response.status, message: providerMessage(json) } };
    if (json === undefined) return { ok: false, failure: { kind: 'bad-response' } };
    return { ok: true, json };
  } catch {
    if (signal.aborted) return { ok: false, aborted: true };
    return { ok: false, failure: { kind: timeout.fired ? 'timeout' : 'network' } };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}
