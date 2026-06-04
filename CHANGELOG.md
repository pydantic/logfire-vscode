## v2026.6.0 (2026-06-04)

Add the **Logfire AI Gateway** as a VSCode Chat / Copilot model provider (the BYOK
`LanguageModelChatProvider` API): discovers the OpenAI and Anthropic models each signed-in deployment
exposes — hosted US/EU and any number of self-hosted instances — and streams chat/agent requests with
tool calling and vision.

Authenticate via OAuth Dynamic Client Registration (RFC 7591) instead of a static CIMD client id,
re-registering automatically when the extension's required scopes change. A per-instance `clientId`
can still be set to authenticate with a static client and skip DCR. Add the **Logfire AI Gateway:
Manage Registered Clients** command to list and unregister clients (RFC 7592); unregistering also
clears that client's stored sign-in.

## v2025.3.0 (2025-07-02)

Improve Readme.

## v2025.2.0 (2025-06-29)

Update bundled [`logfire-lsp`](https://github.com/pydantic/logfire-lsp) version to v0.0.4.

## v2025.1.0 (2025-06-27)

Initial release.
