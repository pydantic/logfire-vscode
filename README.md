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
with **OAuth via Dynamic Client Registration** (RFC 7591) — no static API key, and no separate local
proxy process. At sign-in the extension registers its own OAuth client with the deployment and runs an
authorization-code + PKCE flow; the client is re-registered automatically if the scopes the extension
needs ever change. It discovers the models each gateway exposes (OpenAI and Anthropic routes), streams
chat/agent requests directly to the relevant deployment, and supports tool calling and vision.

Run **Logfire AI Gateway: Sign In** from the command palette (or **Manage** from the model picker)
and pick an instance. You can be signed in to several deployments at once — US, EU, and any number of
self-hosted instances — and models from all of them appear together in the picker. Each instance
keeps its own OAuth tokens in VSCode SecretStorage.

To review or revoke the OAuth clients the extension has registered, run **Logfire AI Gateway: Manage
Registered Clients**. Unregistering a client deletes it from Logfire (RFC 7592) and removes its stored
sign-in for that client.

Key settings (`logfireGateway.*`):

- `logfireGateway.regions` (default `["us", "eu"]`) — which hosted deployments are available.
- `logfireGateway.instances` — self-hosted deployments, each with an `alias` and a base `url`
  (or split `backendUrl`/`gatewayUrl`). Set an optional `clientId` on an entry to authenticate with
  a static OAuth client you registered yourself, skipping Dynamic Client Registration.
- `logfireGateway.requestTimeoutMs`, `logfireGateway.modelRefreshIntervalMinutes`,
  `logfireGateway.modelOverrides` — request timeout, model-list refresh cadence, and per-model
  metadata overrides.

The status bar shows the signed-in instances and an **estimated** spend for the current VSCode
session (summed from the gateway's per-request price-estimate header). It does not show account-wide
spend or limits — that data isn't exposed by the gateway's OAuth surface.

## Commands

All commands are available from the Command Palette (`Cmd`/`Ctrl`+`Shift`+`P`).

| Command | Description |
| --- | --- |
| **Pydantic Logfire: Restart Server** | Restart the bundled Logfire language server (CodeLens / Live View). |
| **Logfire AI Gateway: Sign In** | Authenticate to a Logfire deployment (OAuth + Dynamic Client Registration) and make its models available. |
| **Logfire AI Gateway: Sign Out** | Remove the stored sign-in for a deployment. |
| **Logfire AI Gateway: Manage** | List every configured instance with its signed-in state; sign in/out or open settings. Also reachable from the model picker. |
| **Logfire AI Gateway: Manage Registered Clients** | List the OAuth clients the extension has registered and unregister them (RFC 7592 — deletes the client from Logfire and clears its stored sign-in). |
| **Logfire AI Gateway: Refresh Model List** | Re-query the available models from every signed-in deployment. |
