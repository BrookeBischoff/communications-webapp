// Calls to the account endpoints (/api/*). The session cookie is HttpOnly, so
// this code never sees it; the browser attaches it to each request.
//
// Every call resolves to { ok, status, data, error } and never throws.
// status 0 means the server could not be reached.

async function request(method, path, body) {
  try {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try {
      data = await response.json();
    } catch {
      // no JSON body
    }
    const error = response.ok ? '' : data?.error?.message ?? `Request failed (${response.status}).`;
    return { ok: response.ok, status: response.status, data, error };
  } catch {
    return { ok: false, status: 0, data: null, error: 'Could not reach the server.' };
  }
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
};
