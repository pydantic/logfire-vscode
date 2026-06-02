/**
 * Minimal Server-Sent Events parser. Yields one event per blank-line-delimited
 * block, exposing the `event:` name (default "message") and the joined `data:`
 * payload. Works for both OpenAI (data-only) and Anthropic (named events).
 */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = 'message';
  let data: string[] = [];

  const flush = function* (): Generator<{ event: string; data: string }> {
    if (data.length) {
      yield { event, data: data.join('\n') };
    }
    event = 'message';
    data = [];
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      let line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }
      if (line === '') {
        yield* flush();
      } else if (line.startsWith(':')) {
        // comment, ignore
      } else if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        data.push(line.slice(5).replace(/^ /, ''));
      }
    }
  }
  yield* flush();
}
