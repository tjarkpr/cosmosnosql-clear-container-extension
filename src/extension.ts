import * as vscode from 'vscode';
import { TreeView } from 'vscode';
import { InteractiveBrowserCredential } from "@azure/identity";
import { AzureResourceProvider, AzureResource } from './provider/azure-resource-tree-provider';
import { ClearContainerAdapter } from './adapter/clear-container-adapter';

export function activate(context: vscode.ExtensionContext) {
	initializeWorkspaceState(context);
	initializeContext();

	var treeResourceProvider = new AzureResourceProvider();
	var clearContainerAdapter = new ClearContainerAdapter(treeResourceProvider);
	var treeView : TreeView<AzureResource> | null = null;

	context.subscriptions.push(vscode.commands.registerCommand('cosmosnosql-clear-container-extension.loginToAzure', () => {
		try {
			var credentials = new InteractiveBrowserCredential({});
			treeResourceProvider.updateCredentials(credentials);
			clearContainerAdapter.updateCredentials(credentials);
			context.workspaceState.update('isLoggedIntoAzure', true);
			updateContext('isLoggedIntoAzure', true);
			treeView = vscode.window.createTreeView('azure-resource-tree-view', {
				treeDataProvider: treeResourceProvider
			});
		} catch (error) {
			logError(error);
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('cosmosnosql-clear-container-extension.logoutFromAzure', () => {
		treeResourceProvider.updateCredentials(null);
		clearContainerAdapter.updateCredentials(null);
		context.workspaceState.update('isLoggedIntoAzure', false);
		updateContext('isLoggedIntoAzure', false);
		treeResourceProvider.refreshTree();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('cosmosnosql-clear-container-extension.reload', () => {
		var selection = treeView?.selection ?? [];
		selection.forEach(element => {
			treeResourceProvider.refresh(element);
		});
	}));

	context.subscriptions.push(vscode.commands.registerCommand('cosmosnosql-clear-container-extension.clearContainer', async () => {
		var selection = treeView?.selection ?? [];
		for (const element of selection) {
			await clearContainerAdapter.clear(element);
			treeResourceProvider.refresh(element);
		}
	}));
}

function initializeWorkspaceState(context: vscode.ExtensionContext) {
	context.workspaceState.update('isLoggedIntoAzure', false);
}

function initializeContext() {
	updateContext('isLoggedIntoAzure', false);
}

function updateContext(key: string, value: any) {
	vscode.commands.executeCommand(
		'setContext', 
		'cosmosnosql-clear-container-extension.' + key, 
		value);
}

function logError(error: any) {
	if (error instanceof Error) {
		vscode.window.showErrorMessage(error.message);
	}
	if (typeof error === 'string') {
		vscode.window.showErrorMessage(error);
	}
	console.error(error);
}

export function deactivate() {}
