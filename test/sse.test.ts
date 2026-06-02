import { describe, expect, it } from 'vitest';
import { sseEvents } from '../src/gateway/sse';
import { streamOf } from './helpers';

async function collect(chunks: string[]) {
  const out: { event: string; data: string }[] = [];
  for await (const e of sseEvents(streamOf(chunks))) {
    out.push(e);
  }
  return out;
}

describe('sseEvents', () => {
  it('parses data-only events (OpenAI style)', async () => {
    expect(await collect(['data: {"a":1}\n\ndata: [DONE]\n\n'])).toEqual([
      { event: 'message', data: '{"a":1}' },
      { event: 'message', data: '[DONE]' },
    ]);
  });

  it('parses named events split across chunks (Anthropic style)', async () => {
    expect(await collect(['event: content_block_delta\n', 'data: {"x":', '1}\n\n'])).toEqual([
      { event: 'content_block_delta', data: '{"x":1}' },
    ]);
  });

  it('joins multiple data lines and ignores comments', async () => {
    expect(await collect([': keepalive\ndata: a\ndata: b\n\n'])).toEqual([{ event: 'message', data: 'a\nb' }]);
  });
});
