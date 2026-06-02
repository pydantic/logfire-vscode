import * as vscode from 'vscode';
import { sseEvents } from './sse';

/**
 * OpenAI Chat Completions translation: VSCode chat messages -> request payload,
 * and the streamed SSE response -> VSCode response parts.
 */

interface OpenAITextContent {
  type: 'text';
  text: string;
}
interface OpenAIImageContent {
  type: 'image_url';
  image_url: { url: string };
}
type OpenAIContent = OpenAITextContent | OpenAIImageContent;

interface OpenAIToolCall {
  index?: number;
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIContent[] | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export function buildOpenAIPayload(
  modelId: string,
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: modelId,
    stream: true,
    messages: messages.map(translateMessage),
  };
  const tools = options.tools;
  if (tools?.length) {
    payload.tools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description ?? '',
        parameters: t.inputSchema ?? { type: 'object', properties: {} },
      },
    }));
    payload.tool_choice = 'auto';
  }
  if (typeof options.modelOptions?.temperature === 'number') {
    payload.temperature = options.modelOptions.temperature;
  }
  return payload;
}

function translateMessage(m: vscode.LanguageModelChatRequestMessage): OpenAIMessage {
  const content: OpenAIContent[] = [];
  const toolCalls: OpenAIToolCall[] = [];

  for (const part of m.content as readonly unknown[]) {
    if (part instanceof vscode.LanguageModelTextPart) {
      content.push({ type: 'text', text: part.value });
    } else if (part instanceof vscode.LanguageModelToolCallPart) {
      toolCalls.push({
        id: part.callId,
        type: 'function',
        function: { name: part.name, arguments: JSON.stringify(part.input ?? {}) },
      });
    } else if (part instanceof vscode.LanguageModelToolResultPart) {
      return { role: 'tool', tool_call_id: part.callId, content: toolResultText(part) };
    } else if (part instanceof vscode.LanguageModelDataPart && isImage(part)) {
      const b64 = Buffer.from(part.data).toString('base64');
      content.push({ type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${b64}` } });
    }
  }

  const role = m.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user';
  const onlyText = content.every((c) => c.type === 'text');
  const msg: OpenAIMessage = {
    role,
    content:
      content.length === 0 ? null : onlyText ? content.map((c) => (c as OpenAITextContent).text).join('') : content,
  };
  if (toolCalls.length) {
    msg.tool_calls = toolCalls;
  }
  return msg;
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

/** Parse the OpenAI SSE stream and emit text + tool-call parts. */
export async function pumpOpenAI(
  body: ReadableStream<Uint8Array>,
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
): Promise<void> {
  const toolCalls = new Map<number, { id: string; name: string; args: string }>();

  for await (const { data } of sseEvents(body)) {
    if (data === '[DONE]') {
      continue;
    }
    let chunk: any;
    try {
      chunk = JSON.parse(data);
    } catch {
      continue;
    }
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) {
      continue;
    }
    if (typeof delta.content === 'string' && delta.content.length) {
      progress.report(new vscode.LanguageModelTextPart(delta.content));
    }
    for (const tc of (delta.tool_calls ?? []) as OpenAIToolCall[]) {
      const idx = tc.index ?? 0;
      const acc = toolCalls.get(idx) ?? { id: '', name: '', args: '' };
      if (tc.id) acc.id = tc.id;
      if (tc.function?.name) acc.name = tc.function.name;
      if (tc.function?.arguments) acc.args += tc.function.arguments;
      toolCalls.set(idx, acc);
    }
  }

  for (const acc of toolCalls.values()) {
    if (!acc.name) {
      continue;
    }
    progress.report(new vscode.LanguageModelToolCallPart(acc.id || acc.name, acc.name, safeJson(acc.args)));
  }
}

function safeJson(s: string): object {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}
