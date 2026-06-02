import * as vscode from 'vscode';

/**
 * Status bar indicator for the Logfire AI Gateway.
 *
 * What it can honestly show:
 *  - signed-in state (which instances), as a quick entry point to Manage.
 *  - an *estimated* spend for the current VS Code session, summed from the
 *    `pydantic-ai-gateway-price-estimate` response header the gateway sets on
 *    each proxied request.
 *
 * What it deliberately does NOT show: account-wide spend or day/week/month/total
 * limits. The gateway's OAuth (`project:gateway_proxy`) surface exposes no
 * usage/limits endpoint — only the per-request estimate above — so that data is
 * not available to this extension. See README "Spending".
 */
export class StatusBar {
  private readonly item: vscode.StatusBarItem;
  private signedIn: string[] = [];
  private sessionSpendUsd = 0;
  private readonly perInstance = new Map<string, number>();

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'logfireGateway.manage';
    this.render();
    this.item.show();
  }

  setSignedIn(labels: string[]): void {
    this.signedIn = labels;
    this.render();
  }

  addSpend(instanceLabel: string, usd: number): void {
    if (!(usd > 0)) {
      return;
    }
    this.sessionSpendUsd += usd;
    this.perInstance.set(instanceLabel, (this.perInstance.get(instanceLabel) ?? 0) + usd);
    this.render();
  }

  dispose(): void {
    this.item.dispose();
  }

  private render(): void {
    const spend = this.sessionSpendUsd > 0 ? `  $${this.sessionSpendUsd.toFixed(4)}` : '';
    this.item.text = this.signedIn.length === 0 ? '$(sparkle) Logfire: sign in' : `$(sparkle) Logfire${spend}`;
    this.item.tooltip = this.tooltip();
  }

  private tooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;
    md.appendMarkdown('**Logfire AI Gateway**\n\n');
    if (this.signedIn.length) {
      md.appendMarkdown(`Signed in: ${this.signedIn.join(', ')}\n\n`);
    } else {
      md.appendMarkdown('_Not signed in._ Click to sign in.\n\n');
    }
    if (this.sessionSpendUsd > 0) {
      md.appendMarkdown(`Estimated spend this session: **$${this.sessionSpendUsd.toFixed(4)}**\n\n`);
      for (const [label, usd] of this.perInstance) {
        md.appendMarkdown(`- ${label}: $${usd.toFixed(4)}\n`);
      }
      md.appendMarkdown('\n');
    }
    md.appendMarkdown(
      '_Estimate = sum of the gateway’s per-request price estimates for requests made from this VS Code session. It is not your account total, and day/week/month/total spend & limits are not available through the gateway API._',
    );
    return md;
  }
}

/**
 * Parse the gateway's `pydantic-ai-gateway-price-estimate` header (e.g.
 * `"0.0123USD"`) into a number of USD. Returns undefined if absent/unparseable.
 */
export function parsePriceEstimateUsd(header: string | null | undefined): number | undefined {
  if (!header) {
    return undefined;
  }
  const match = /-?\d*\.?\d+/.exec(header);
  if (!match) {
    return undefined;
  }
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : undefined;
}
