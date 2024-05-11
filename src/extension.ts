import { ExtensionContext, commands, window, TreeView } from 'vscode';
import { UpdateVSCodeContextValue, LogError, GetFullExtensionName } from './helper/vscode-helper';
import { TokenCredential } from "@azure/identity";
import { VSCodeAzureSubscriptionProvider } from "@microsoft/vscode-azext-azureauth";
import { AzureResourceProvider, AzureResource } from './provider/azure-resource-tree-provider';
import { CosmosClientAdapter } from './adapter/cosmos-client-sdk-adapter';


const IS_LOGGED_INTO_AZURE_CONTEXT_KEY: string = "isLoggedIntoAzure";
const LOGIN_TO_AZURE_COMMAND_NAME: string = "loginToAzure";
const LOGOUT_FROM_AZURE_COMMAND_NAME: string = "logoutFromAzure";
const RELAOD_COMMAND_NAME: string = "reload";
const CLEAR_CONTAINER_COMMAND_NAME: string = "clearContainer";
const AZURE_TREE_VIEW_NAME: string = "azure-resource-tree-view";

export function activate(context: ExtensionContext): void {
	UpdateVSCodeContextValue(IS_LOGGED_INTO_AZURE_CONTEXT_KEY, false);

	const _subscriptionProvider: VSCodeAzureSubscriptionProvider = new VSCodeAzureSubscriptionProvider();
	const _azureResourceProvider: AzureResourceProvider = new AzureResourceProvider(_subscriptionProvider);
	const _cosmosClientAdapter: CosmosClientAdapter = new CosmosClientAdapter(_azureResourceProvider);
	
	let _azureResourceTreeView: TreeView<AzureResource> | null = null;
	let _credentials: Map<string, TokenCredential> = new Map<string, TokenCredential>();

	context.subscriptions.push(
		commands.registerCommand(
			GetFullExtensionName(LOGIN_TO_AZURE_COMMAND_NAME), async () => 
	{
		try {
			if (!await _subscriptionProvider.signIn()) { throw Error("Login not successfull"); }

			const subscriptions = await _subscriptionProvider.getSubscriptions();
			subscriptions.forEach(s => {
				_credentials.set(s.subscriptionId, s.credential);
			})

			_azureResourceProvider.updateCredentials(_credentials);
			UpdateVSCodeContextValue(IS_LOGGED_INTO_AZURE_CONTEXT_KEY, true);

			_azureResourceTreeView = window.createTreeView(AZURE_TREE_VIEW_NAME, {
				treeDataProvider: _azureResourceProvider
			});
		} catch (error) { LogError(error); }
	}));

	context.subscriptions.push(
		commands.registerCommand(
			GetFullExtensionName(LOGOUT_FROM_AZURE_COMMAND_NAME), () => 
	{
		_credentials.clear()
		_azureResourceProvider.updateCredentials(null);
		UpdateVSCodeContextValue(IS_LOGGED_INTO_AZURE_CONTEXT_KEY, false);
		_azureResourceProvider.refreshTree();
	}));

	context.subscriptions.push(
		commands.registerCommand(
			GetFullExtensionName(RELAOD_COMMAND_NAME), () => 
	{
		const selection = _azureResourceTreeView?.selection ?? [];
		selection.forEach(element => {
			_azureResourceProvider.refresh(element);
		});
	}));

	context.subscriptions.push(
		commands.registerCommand(
			GetFullExtensionName(CLEAR_CONTAINER_COMMAND_NAME), async () => 
	{
		const selection = _azureResourceTreeView?.selection ?? [];
		for (const element of selection) {
			await _cosmosClientAdapter.clearSelection(element);
			_azureResourceProvider.refresh(element);
		}
	}));
}

export function deactivate() {}
