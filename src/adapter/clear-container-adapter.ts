import * as vscode from 'vscode';
import { TokenCredential } from "@azure/identity";
import { AzureResource, Subscription, CosmosAccount, CosmosDatabase, CosmosContainer, AzureResourceProvider } from "../provider/azure-resource-tree-provider";

export class ClearContainerAdapter {
    constructor(
        private readonly resourceTreeProvider: AzureResourceProvider,
        private credentials: TokenCredential | null = null
    ) {}

    public updateCredentials(credentials: TokenCredential | null) {
        this.credentials = credentials;
    }

    public async clear(selection: AzureResource) {
        switch (selection.constructor) {
            case Subscription:
                var subscription = selection as Subscription;
                await ClearContainerAdapter.runWithCheckTextPrompt(
                    `Please type the subscription label to confirm clearing the subscription ${subscription.label}`,
                    subscription.label,
                    async () => await this.clearSubscription(subscription)
                );
                break;
            case CosmosAccount:
                var account = selection as CosmosAccount;
                await ClearContainerAdapter.runWithCheckTextPrompt(
                    `Please type the account name to confirm clearing the account ${account.label}`,
                    account.label,
                    async () => await this.clearAccount(account)
                );
                break;
            case CosmosDatabase:
                var database = selection as CosmosDatabase;
                await ClearContainerAdapter.runWithCheckTextPrompt(
                    `Please type the database name to confirm clearing the database ${database.label}`,
                    database.label,
                    async () => await this.clearDatabase(database)
                );
                break;
            case CosmosContainer:
                var container = selection as CosmosContainer;
                await ClearContainerAdapter.runWithAcceptOrRejectPrompt(
                    `Are you sure you want to clear the container ${container.label}?`,
                    async () => await this.clearContainer(container)
                );
                break;
            default:
                break;
        }
    }

    private async clearSubscription(subscription: Subscription) {
        var accounts = this.resourceTreeProvider.getRelatedCosmosAccounts(subscription.subscriptionId);
        if (accounts) {
            accounts.forEach(account => {
                this.clearAccount(account);
            });
        }
    }

    private async clearAccount(account: CosmosAccount) {
        var databases = this.resourceTreeProvider.getRelatedCosmosDatabases(account.accountId);
        if (databases) {
            databases.forEach(database => {
                this.clearDatabase(database);
            });
        }
    }

    private async clearDatabase(database: CosmosDatabase) {
        var containers = this.resourceTreeProvider.getRelatedCosmosContainers(database.databaseId);
        if (containers) {
            containers.forEach(container => {
                this.clearContainer(container);
            });
        }
    }

    private async clearContainer(container: CosmosContainer) {
        var items = await container.container.items.readAll().fetchAll();
        items.resources.forEach(async item => {
            if (item.id) {
                await container.container.item(item.id).delete();
            }
        });
    }

    private static async runWithAcceptOrRejectPrompt(
        promptMessage: string,
        action: () => Promise<void>
    ) {
        await vscode.window
        .showInformationMessage(promptMessage, "Yes", "No")
        .then(async answer => {
            if (answer === "Yes") {
                await action();
            }
        });
    }

    private static async runWithCheckTextPrompt(
        promptMessage: string,
        checkText: string,
        action: () => Promise<void>
    ) {
        await vscode.window
        .showInputBox({
            prompt: promptMessage,
            placeHolder: checkText
        })
        .then(async text => {
            if (text === checkText) {
                await action();
            }
        });
    }
}