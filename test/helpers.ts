import * as vscode from 'vscode';

/** Build a ReadableStream<Uint8Array> from string chunks (split arbitrarily). */
export function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(enc.encode(c));
      }
      controller.close();
    },
  });
}

/** Collect parts reported to a vscode.Progress. */
export function collector() {
  const parts: unknown[] = [];
  const progress = { report: (p: unknown) => parts.push(p) };
  const text = () =>
    parts
      .filter((p) => p instanceof vscode.LanguageModelTextPart)
      .map((p) => (p as vscode.LanguageModelTextPart).value)
      .join('');
  const toolCalls = () => parts.filter((p) => p instanceof vscode.LanguageModelToolCallPart) as any[];
  return { parts, progress: progress as any, text, toolCalls };
}
