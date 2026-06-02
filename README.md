# Pydantic Logfire extension for VSCode

A Visual Studio Code extension for the [Logfire platform](https://logfire.pydantic.dev/docs/).

> [!WARNING]
>
> This project is in early development.

![LSP Example](https://raw.githubusercontent.com/pydantic/logfire-vscode/refs/heads/main/assets/example.png)

The extension provides CodeLens annotations on Logfire logging calls, redirecting to the Live View.

## Installation

The extension is available on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=Pydantic.logfire).

**To make use of the extension**, [project credentials](https://logfire.pydantic.dev/docs/#about-logfire)
should be set up first (in the `.logfire/` directory at the root of your project).

## Logfire AI Gateway

The extension also registers the [Pydantic Logfire AI Gateway](https://logfire.pydantic.dev) as a
**VSCode Chat / Copilot model provider** (the BYOK `LanguageModelChatProvider` API), authenticated
with the **Logfire CIMD OAuth flow** — no static API key, and no separate local proxy process. It
discovers the models each gateway exposes (OpenAI and Anthropic routes), streams chat/agent requests
directly to the relevant deployment, and supports tool calling and vision.

Run **Logfire AI Gateway: Sign In** from the command palette (or **Manage** from the model picker)
and pick an instance. You can be signed in to several deployments at once — US, EU, and any number of
self-hosted instances — and models from all of them appear together in the picker. Each instance
keeps its own OAuth tokens in VSCode SecretStorage.

Key settings (`logfireGateway.*`):

- `logfireGateway.regions` (default `["us", "eu"]`) — which hosted deployments are available.
- `logfireGateway.instances` — self-hosted deployments, each with an `alias` and a base `url`
  (or split `backendUrl`/`gatewayUrl`). A `clientId` (CIMD URL) may be set per instance; it defaults
  to the canonical hosted document, which works for self-hosted/localhost backends that can't serve
  their own CIMD document.
- `logfireGateway.requestTimeoutMs`, `logfireGateway.modelRefreshIntervalMinutes`,
  `logfireGateway.modelOverrides` — request timeout, model-list refresh cadence, and per-model
  metadata overrides.

The status bar shows the signed-in instances and an **estimated** spend for the current VSCode
session (summed from the gateway's per-request price-estimate header). It does not show account-wide
spend or limits — that data isn't exposed by the gateway's OAuth surface.
