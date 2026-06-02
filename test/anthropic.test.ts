import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { buildAnthropicPayload, pumpAnthropic } from '../src/gateway/anthropic';
import { collector, streamOf } from './helpers';

const userText = (s: string) => ({
  role: vscode.LanguageModelChatMessageRole.User,
  content: [new vscode.LanguageModelTextPart(s)],
});

describe('buildAnthropicPayload', () => {
  it('sets max_tokens and content blocks', () => {
    const p: any = buildAnthropicPayload('claude-3-5-sonnet', 1024, [userText('hi')] as any, {} as any);
    expect(p.max_tokens).toBe(1024);
    expect(p.stream).toBe(true);
    expect(p.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);
  });

  it('defaults max_tokens when missing', () => {
    const p: any = buildAnthropicPayload('claude', undefined, [userText('hi')] as any, {} as any);
    expect(p.max_tokens).toBe(4096);
  });

  it('maps tools to input_schema', () => {
    const p: any = buildAnthropicPayload(
      'claude',
      10,
      [userText('hi')] as any,
      {
        tools: [{ name: 'foo', description: 'd', inputSchema: { type: 'object' } }],
      } as any,
    );
    expect(p.tools[0]).toEqual({ name: 'foo', description: 'd', input_schema: { type: 'object' } });
  });

  it('image part becomes a base64 image source', () => {
    const msg = {
      role: vscode.LanguageModelChatMessageRole.User,
      content: [vscode.LanguageModelDataPart.image(new Uint8Array([1, 2, 3]), 'image/png')],
    };
    const p: any = buildAnthropicPayload('claude', 10, [msg] as any, {} as any);
    expect(p.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AQID' },
    });
  });
});

describe('pumpAnthropic', () => {
  it('emits text deltas and a completed tool call', async () => {
    const sse =
      'event: content_block_delta\ndata: {"index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n' +
      'event: content_block_start\ndata: {"index":1,"content_block":{"type":"tool_use","id":"t1","name":"foo"}}\n\n' +
      'event: content_block_delta\ndata: {"index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"a\\":1}"}}\n\n' +
      'event: content_block_stop\ndata: {"index":1}\n\n' +
      'event: message_stop\ndata: {}\n\n';
    const c = collector();
    await pumpAnthropic(streamOf([sse]), c.progress);
    expect(c.text()).toBe('Hi');
    const calls = c.toolCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('foo');
    expect(calls[0].callId).toBe('t1');
    expect(calls[0].input).toEqual({ a: 1 });
  });
});
