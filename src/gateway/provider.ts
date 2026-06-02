import * as vscode from 'vscode';
import { GatewayClient } from './gateway';
import { Instance, ModelOverride } from './config';
import { buildOpenAIPayload, pumpOpenAI } from './openai';
import { buildAnthropicPayload, pumpAnthropic } from './anthropic';
import { parsePriceEstimateUsd } from './statusbar';

/**
 * LanguageModelChatProvider backed by one or more Logfire AI Gateway instances.
 *
 * Models from every signed-in instance are aggregated into one picker. Each
 * model id is namespaced `instance::route::model` so a chat request routes back
 * to the right instance (OAuth token + gateway URL) and route (provider slug).
 * Routes whose provider is `anthropic` use the Messages API; everything else
 * uses OpenAI Chat Completions.
 */

const SEP = '::';

export function encodeModelId(instanceId: string, route: string, modelId: string): string {
  return `${instanceId}${SEP}${route}${SEP}${modelId}`;
}

export function decodeModelId(id: string): { instanceId: string; route: string; modelId: string } | undefined {
  const first = id.indexOf(SEP);
  const second = id.indexOf(SEP, first + SEP.length);
  if (first < 0 || second < 0) {
    return undefined;
  }
  return {
    instanceId: id.slice(0, first),
    route: id.slice(first + SEP.length, second),
    modelId: id.slice(second + SEP.length),
  };
}

/** Whether a route's gateway provider speaks the Anthropic Messages API. */
export function isAnthropicProvider(provider: string | undefined, modelId: string): boolean {
  if (provider) {
    return provider === 'anthropic';
  }
  return /(^|[/:])claude/i.test(modelId); // fallback when provider is unknown
}

export class LogfireGatewayProvider implements vscode.LanguageModelChatProvider {
  private readonly changed = new vscode.EventEmitter<void>();
  /** Fired when the available model list may have changed (sign in/out, refresh). */
  readonly onDidChange = this.changed.event;
  /** Provider slug per namespaced model id, learned during model discovery. */
  private readonly providerById = new Map<string, string>();

  constructor(
    private readonly client: GatewayClient,
    private readonly signedInInstances: () => Promise<Instance[]>,
    private readonly getOverrides: () => Record<string, ModelOverride>,
    /** Called with the gateway's per-request price estimate (USD), if present. */
    private readonly onSpend?: (instance: Instance, usd: number) => void,
  ) {}

  /** Ask VSCode to re-query the model list. */
  refresh(): void {
    this.changed.fire();
  }

  async provideLanguageModelChatInformation(
    _options: { silent: boolean },
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelChatInformation[]> {
    const instances = await this.signedInInstances();
    const overrides = this.getOverrides();
    const out: vscode.LanguageModelChatInformation[] = [];

    const perInstance = await Promise.all(
      instances.map(async (instance) => {
        try {
          return { instance, routes: await this.client.listModels(instance) };
        } catch {
          return { instance, routes: [] };
        }
      }),
    );

    for (const { instance, routes } of perInstance) {
      for (const { route, provider, models } of routes) {
        for (const m of models) {
          const id = encodeModelId(instance.id, route, m.id);
          this.providerById.set(id, provider);
          const o = overrides[id] ?? overrides[m.id] ?? {};
          out.push({
            id,
            name: `${m.name ?? m.id} (${instance.label}/${route})`,
            family: o.family ?? provider,
            version: '1.0.0',
            maxInputTokens: o.maxInputTokens ?? m.context_window ?? 128_000,
            maxOutputTokens: o.maxOutputTokens ?? 16_384,
            capabilities: {
              toolCalling: o.toolCalling ?? true,
              imageInput: o.imageInput ?? false,
            },
          } as vscode.LanguageModelChatInformation);
        }
      }
    }
    return out;
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const decoded = decodeModelId(model.id);
    if (!decoded) {
      throw new vscode.LanguageModelError(`Unrecognized model id: ${model.id}`);
    }
    const instances = await this.signedInInstances();
    const instance = instances.find((i) => i.id === decoded.instanceId);
    if (!instance) {
      throw new vscode.LanguageModelError(
        `Instance "${decoded.instanceId}" is not signed in. Run "Logfire AI Gateway: Sign In".`,
      );
    }

    const anthropic = isAnthropicProvider(this.providerById.get(model.id), decoded.modelId);
    const path = anthropic ? 'v1/messages' : 'v1/chat/completions';
    const payload = anthropic
      ? buildAnthropicPayload(decoded.modelId, model.maxOutputTokens, messages, options)
      : buildOpenAIPayload(decoded.modelId, messages, options);

    const abort = new AbortController();
    const sub = token.onCancellationRequested(() => abort.abort());
    try {
      const res = await this.client.chatStream(instance, decoded.route, path, payload, abort.signal);
      if (!res.ok || !res.body) {
        const detail = res.body ? await res.text() : '';
        throw new vscode.LanguageModelError(`Gateway error ${res.status}: ${detail}`);
      }
      const estimate = parsePriceEstimateUsd(res.headers.get('pydantic-ai-gateway-price-estimate'));
      if (estimate !== undefined && this.onSpend) {
        this.onSpend(instance, estimate);
      }
      if (anthropic) {
        await pumpAnthropic(res.body, progress);
      } else {
        await pumpOpenAI(res.body, progress);
      }
    } finally {
      sub.dispose();
    }
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken,
  ): Promise<number> {
    const s = typeof text === 'string' ? text : messageToPlainText(text);
    return Math.ceil(s.length / 4); // ~4 chars/token heuristic
  }
}

function messageToPlainText(m: vscode.LanguageModelChatRequestMessage): string {
  return (m.content as readonly unknown[])
    .map((p) => (p instanceof vscode.LanguageModelTextPart ? p.value : ''))
    .join('');
}
