import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { buildOpenAIPayload, pumpOpenAI } from '../src/gateway/openai';
import { collector, streamOf } from './helpers';

const userText = (s: string) => ({
  role: vscode.LanguageModelChatMessageRole.User,
  content: [new vscode.LanguageModelTextPart(s)],
});

describe('buildOpenAIPayload', () => {
  it('text-only message uses string content', () => {
    const p: any = buildOpenAIPayload('gpt-4o', [userText('hi')] as any, {} as any);
    expect(p.model).toBe('gpt-4o');
    expect(p.stream).toBe(true);
    expect(p.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('image part becomes an image_url data url', () => {
    const msg = {
      role: vscode.LanguageModelChatMessageRole.User,
      content: [
        new vscode.LanguageModelTextPart('look'),
        vscode.LanguageModelDataPart.image(new Uint8Array([1, 2, 3]), 'image/png'),
      ],
    };
    const p: any = buildOpenAIPayload('gpt-4o', [msg] as any, {} as any);
    expect(p.messages[0].content).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
    ]);
  });

  it('tool result becomes a tool message', () => {
    const msg = {
      role: vscode.LanguageModelChatMessageRole.User,
      content: [new vscode.LanguageModelToolResultPart('call1', [new vscode.LanguageModelTextPart('42')])],
    };
    const p: any = buildOpenAIPayload('gpt-4o', [msg] as any, {} as any);
    expect(p.messages[0]).toEqual({ role: 'tool', tool_call_id: 'call1', content: '42' });
  });

  it('maps tools and sets tool_choice', () => {
    const p: any = buildOpenAIPayload(
      'gpt-4o',
      [userText('hi')] as any,
      {
        tools: [{ name: 'foo', description: 'd', inputSchema: { type: 'object' } }],
      } as any,
    );
    expect(p.tools[0]).toEqual({
      type: 'function',
      function: { name: 'foo', description: 'd', parameters: { type: 'object' } },
    });
    expect(p.tool_choice).toBe('auto');
  });
});

describe('pumpOpenAI', () => {
  it('emits streamed text then accumulated tool calls', async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"foo","arguments":"{\\"a\\":"}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}\n\n' +
      'data: [DONE]\n\n';
    const c = collector();
    await pumpOpenAI(streamOf([sse]), c.progress);
    expect(c.text()).toBe('Hello');
    const calls = c.toolCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('foo');
    expect(calls[0].callId).toBe('c1');
    expect(calls[0].input).toEqual({ a: 1 });
  });
});
