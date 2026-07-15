/**
 * Resolves and serializes an async response before writing headers. A loader or
 * JSON serialization failure therefore produces one 500 response instead of a
 * partial 200 followed by ERR_HTTP_HEADERS_SENT.
 */
export async function writeAsyncJson(res, load, { successStatus = 200 } = {}) {
  let status = successStatus;
  let body;
  try {
    body = JSON.stringify(await load());
  } catch (error) {
    status = 500;
    body = JSON.stringify({ error: String(error?.message ?? error).slice(0, 500) });
  }
  res.writeHead(status);
  res.end(body);
}
