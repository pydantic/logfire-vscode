// Logfire AI Gateway feature: registers a LanguageModelChatProvider backed by
// one or more Logfire AI Gateway instances (CIMD OAuth, auto region). This is
// wired into the extension's main activate() in src/extension.ts.
import * as vscode from 'vscode';
import { GatewayAuth } from './auth';
import { GatewayAccessError, GatewayClient } from './gateway';
import { LogfireGatewayProvider } from './provider';
import { Instance, listInstances, modelOverrides } from './config';
import { StatusBar } from './statusbar';

const VENDOR = 'logfire-gateway';

export function activateGateway(context: vscode.ExtensionContext): void {
  const auth = new GatewayAuth(context.secrets);
  const client = new GatewayClient(auth);
  const statusBar = new StatusBar();
  context.subscriptions.push(statusBar);

  const signedInInstances = async (): Promise<Instance[]> => {
    const checks = await Promise.all(listInstances().map(async (i) => ((await auth.isSignedIn(i)) ? i : undefined)));
    return checks.filter((i): i is Instance => i !== undefined);
  };

  const provider = new LogfireGatewayProvider(
    client,
    signedInInstances,
    () => modelOverrides(),
    (instance, usd) => statusBar.addSpend(instance.label, usd),
  );

  // Register the BYOK provider. The `vendor` must match
  // contributes.languageModelChatProviders[].vendor in package.json.
  context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(VENDOR, provider));

  const refreshStatus = async () => statusBar.setSignedIn((await signedInInstances()).map((i) => i.label));
  void refreshStatus();

  // Periodic model refresh (0 disables). Re-armed on settings changes.
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  const armAutoRefresh = () => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = undefined;
    }
    const minutes = vscode.workspace.getConfiguration('logfireGateway').get<number>('modelRefreshIntervalMinutes', 5);
    if (minutes > 0) {
      refreshTimer = setInterval(() => provider.refresh(), minutes * 60_000);
    }
  };
  armAutoRefresh();
  context.subscriptions.push({ dispose: () => refreshTimer && clearInterval(refreshTimer) });

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('logfireGateway')) {
        auth.reset();
        armAutoRefresh();
        provider.refresh();
        void refreshStatus();
      }
    }),
  );

  /** Sign into one instance, confirming access by listing its models. */
  const signInInstance = async (instance: Instance): Promise<void> => {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Signing in to ${instance.label}…` },
      async () => {
        try {
          await auth.signIn(instance);
          await client.listModels(instance); // confirms the token is valid for this instance
        } catch (err) {
          await auth.signOut(instance);
          if (err instanceof GatewayAccessError) {
            throw new Error(`${instance.label}: this account has no gateway access here (${err.status}).`);
          }
          throw err;
        }
      },
    );
    provider.refresh();
    void refreshStatus();
    vscode.window.showInformationMessage(`Signed in to ${instance.label}.`);
  };

  /** Pick an instance and sign in. */
  const signIn = async (): Promise<void> => {
    const instances = listInstances();
    if (instances.length === 0) {
      vscode.window.showWarningMessage('No Logfire instances configured. Check the logfireGateway settings.');
      return;
    }
    const items = await Promise.all(
      instances.map(async (i) => ({
        label: i.label,
        description: (await auth.isSignedIn(i)) ? '$(check) signed in — re-authenticate' : i.gateway,
        instance: i,
      })),
    );
    const pick =
      items.length === 1
        ? items[0]
        : await vscode.window.showQuickPick(items, { title: 'Sign in to Logfire instance' });
    if (pick) {
      await signInInstance(pick.instance).catch((err) =>
        vscode.window.showErrorMessage(`Logfire sign-in failed: ${(err as Error).message}`),
      );
    }
  };

  const signOut = async (): Promise<void> => {
    const instances = await signedInInstances();
    if (instances.length === 0) {
      vscode.window.showInformationMessage('Not signed in to any Logfire instance.');
      return;
    }
    const items = instances.map((i) => ({ label: i.label, instance: i }));
    const pick =
      items.length === 1
        ? items[0]
        : await vscode.window.showQuickPick(items, { title: 'Sign out of Logfire instance' });
    if (pick) {
      await auth.signOut(pick.instance);
      provider.refresh();
      void refreshStatus();
      vscode.window.showInformationMessage(`Signed out of ${pick.instance.label}.`);
    }
  };

  // managementCommand target — shows every instance with its signed-in state.
  const manage = async (): Promise<void> => {
    const instances = listInstances();
    const items = await Promise.all(
      instances.map(async (i) => {
        const on = await auth.isSignedIn(i);
        return {
          label: `${on ? '$(check)' : '$(circle-large-outline)'} ${i.label}`,
          description: on ? 'signed in — select to sign out' : 'select to sign in',
          instance: i,
          on,
        };
      }),
    );
    const pick = await vscode.window.showQuickPick(
      [...items, { label: '$(gear) Open settings', description: '', instance: undefined, on: false }],
      { title: 'Logfire AI Gateway — instances' },
    );
    if (!pick) {
      return;
    }
    if (!pick.instance) {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'logfireGateway');
    } else if (pick.on) {
      await auth.signOut(pick.instance);
      provider.refresh();
      void refreshStatus();
      vscode.window.showInformationMessage(`Signed out of ${pick.instance.label}.`);
    } else {
      await signInInstance(pick.instance).catch((err) =>
        vscode.window.showErrorMessage(`Logfire sign-in failed: ${(err as Error).message}`),
      );
    }
  };

  const refreshModels = () => {
    provider.refresh();
    vscode.window.showInformationMessage('Refreshing Logfire AI Gateway models…');
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('logfireGateway.signIn', signIn),
    vscode.commands.registerCommand('logfireGateway.signOut', signOut),
    vscode.commands.registerCommand('logfireGateway.manage', manage),
    vscode.commands.registerCommand('logfireGateway.refreshModels', refreshModels),
  );
}
