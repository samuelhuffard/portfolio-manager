/**
 * Resolves and serializes an async response before writing headers. A loader or
 * JSON serialization failure therefore produces one 500 response instead of a
 * partial 200 followed by ERR_HTTP_HEADERS_SENT.
 */
const INTERNAL_ERROR_BODY = JSON.stringify({ error: "Internal server error" });

function reportFailure(log, context, error) {
  try {
    log(`[HTTP] ${context}:`, error instanceof Error ? error : String(error));
  } catch {
    // Logging must never turn an already-contained HTTP failure into a process
    // rejection.
  }
}

export async function writeAsyncJson(res, load, { successStatus = 200, log = console.error } = {}) {
  let status = successStatus;
  let body;
  try {
    body = JSON.stringify(await load());
    if (body === undefined) throw new TypeError("Async JSON loader returned a non-serializable undefined value.");
  } catch (error) {
    status = 500;
    body = INTERNAL_ERROR_BODY;
    reportFailure(log, "async JSON loader failed", error);
  }

  if (res.headersSent || res.writableEnded || res.destroyed) {
    reportFailure(log, "async JSON response was no longer writable", "response already sent, ended, or destroyed");
    return false;
  }
  try {
    res.writeHead(status);
    res.end(body);
    return true;
  } catch (error) {
    reportFailure(log, "async JSON response write failed", error);
    return false;
  }
}
