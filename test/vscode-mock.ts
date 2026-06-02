/**
 * Minimal stand-in for the `vscode` module so the extension's pure logic can be
 * unit-tested outside the Extension Host. Only the surface the source touches at
 * runtime is implemented. Tests and source resolve `vscode` to this same module
 * (via the vitest alias), so `instanceof` checks line up.
 */

// ---- configuration store ---------------------------------------------------

const store = new Map<string, unknown>();

/** Set config values keyed by full path, e.g. `logfireGateway.regions`. */
export function __setConfig(values: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(values)) {
    store.set(k, v);
  }
}

export function __resetConfig(): void {
  store.clear();
}

export const workspace = {
  getConfiguration(section: string) {
    return {
      get<T>(key: string, def?: T): T {
        const full = `${section}.${key}`;
        return store.has(full) ? (store.get(full) as T) : (def as T);
      },
    };
  },
  onDidChangeConfiguration() {
    return { dispose() {} };
  },
};

// ---- events ----------------------------------------------------------------

export class EventEmitter<T> {
  private listeners: ((e: T) => void)[] = [];
  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => {} };
  };
  fire(e: T): void {
    for (const l of this.listeners) l(e);
  }
  dispose(): void {
    this.listeners = [];
  }
}

// ---- chat message/response parts ------------------------------------------

export enum LanguageModelChatMessageRole {
  User = 1,
  Assistant = 2,
}

export class LanguageModelTextPart {
  constructor(public value: string) {}
}

export class LanguageModelToolCallPart {
  constructor(
    public callId: string,
    public name: string,
    public input: object,
  ) {}
}

export class LanguageModelToolResultPart {
  constructor(
    public callId: string,
    public content: unknown[],
  ) {}
}

export class LanguageModelDataPart {
  constructor(
    public mimeType: string,
    public data: Uint8Array,
  ) {}
  static image(data: Uint8Array, mime: string): LanguageModelDataPart {
    return new LanguageModelDataPart(mime, data);
  }
}

export class LanguageModelError extends Error {}

// ---- misc ------------------------------------------------------------------

export const Uri = {
  parse(value: string) {
    return { toString: () => value };
  },
};

export const env = {
  openExternal: async () => true,
};

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export class MarkdownString {
  value = '';
  isTrusted = false;
  constructor(
    value?: string,
    public supportThemeIcons = false,
  ) {
    this.value = value ?? '';
  }
  appendMarkdown(v: string): this {
    this.value += v;
    return this;
  }
}

export const window = {
  createStatusBarItem() {
    return { text: '', tooltip: undefined as unknown, command: '', show() {}, hide() {}, dispose() {} };
  },
};
