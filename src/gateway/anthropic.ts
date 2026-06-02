import * as vscode from 'vscode';
import { sseEvents } from './sse';

/**
 * Anthropic Messages API translation: VSCode chat messages -> request payload,
 * and the streamed SSE response -> VSCode response parts. Used for routes whose
 * gateway provider is `anthropic` (served at `/proxy/{route}/v1/messages`).
 */

type Block =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: Block[];
}

const DEFAULT_MAX_TOKENS = 4096;

export function buildAnthropicPayload(
  modelId: string,
  maxOutputTokens: number | undefined,
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: modelId,
    stream: true,
    max_tokens: maxOutputTokens && maxOutputTokens > 0 ? maxOutputTokens : DEFAULT_MAX_TOKENS,
    messages: messages.map(translateMessage),
  };
  const tools = options.tools;
  if (tools?.length) {
    payload.tools = tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      input_schema: t.inputSchema ?? { type: 'object', properties: {} },
    }));
  }
  if (typeof options.modelOptions?.temperature === 'number') {
    payload.temperature = options.modelOptions.temperature;
  }
  return payload;
}

function translateMessage(m: vscode.LanguageModelChatRequestMessage): AnthropicMessage {
  const role = m.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user';
  const content: Block[] = [];

  for (const part of m.content as readonly unknown[]) {
    if (part instanceof vscode.LanguageModelTextPart) {
      if (part.value) {
        content.push({ type: 'text', text: part.value });
      }
    } else if (part instanceof vscode.LanguageModelToolCallPart) {
      content.push({ type: 'tool_use', id: part.callId, name: part.name, input: part.input ?? {} });
    } else if (part instanceof vscode.LanguageModelToolResultPart) {
      content.push({ type: 'tool_result', tool_use_id: part.callId, content: toolResultText(part) });
    } else if (part instanceof vscode.LanguageModelDataPart && isImage(part)) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: part.mimeType, data: Buffer.from(part.data).toString('base64') },
      });
    }
  }
  return { role, content };
}

function isImage(part: vscode.LanguageModelDataPart): boolean {
  return typeof part.mimeType === 'string' && part.mimeType.startsWith('image/');
}

function toolResultText(part: vscode.LanguageModelToolResultPart): string {
  const content = (part as any).content as readonly unknown[] | undefined;
  if (!content) {
    return '';
  }
  return content.map((c) => (c instanceof vscode.LanguageModelTextPart ? c.value : JSON.stringify(c))).join('');
}

/** Parse the Anthropic Messages SSE stream and emit text + tool-call parts. */
export async function pumpAnthropic(
  body: ReadableStream<Uint8Array>,
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
): Promise<void> {
  // tool_use blocks accumulate partial JSON across input_json_delta events.
  const blocks = new Map<number, { id: string; name: string; json: string }>();

  for await (const { event, data } of sseEvents(body)) {
    let payload: any;
    try {
      payload = JSON.parse(data);
    } catch {
      continue;
    }
    switch (event) {
      case 'content_block_start': {
        const block = payload.content_block;
        if (block?.type === 'tool_use') {
          blocks.set(payload.index, { id: block.id, name: block.name, json: '' });
        }
        break;
      }
      case 'content_block_delta': {
        const delta = payload.delta;
        if (delta?.type === 'text_delta' && delta.text) {
          progress.report(new vscode.LanguageModelTextPart(delta.text));
        } else if (delta?.type === 'input_json_delta') {
          const acc = blocks.get(payload.index);
          if (acc) {
            acc.json += delta.partial_json ?? '';
          }
        }
        break;
      }
      case 'content_block_stop': {
        const acc = blocks.get(payload.index);
        if (acc?.name) {
          progress.report(new vscode.LanguageModelToolCallPart(acc.id || acc.name, acc.name, safeJson(acc.json)));
          blocks.delete(payload.index);
        }
        break;
      }
      default:
        break;
    }
  }
}

function safeJson(s: string): object {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}
