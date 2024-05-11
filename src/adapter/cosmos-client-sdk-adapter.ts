import { window } from "vscode";
import { TokenCredential } from "@azure/identity";
import { 
    AzureResource, 
    Subscription, 
    CosmosAccount, 
    CosmosDatabase, 
    CosmosContainer, 
    AzureResourceProvider 
} from "../provider/azure-resource-tree-provider";


const SUBSCRIPTION_CHECK_MESSAGE: string = "Please type the subscription label to confirm clearing the subscription"
const ACCOUNT_CHECK_MESSAGE: string = "Please type the account label to confirm clearing the account"
const DATABASE_CHECK_MESSAGE: string = "Please type the database label to confirm clearing the database"
const CONTAINER_CHECK_MESSAGE: string = "Are you sure you want to clear the container"
const YES: string = "Yes"
const NO: string = "No"

export class CosmosClientAdapter {
    constructor(
        private readonly _azureResourceProvider: AzureResourceProvider
    ) {}

    public async clearSelection(
        selection: AzureResource): Promise<void> 
    {
        switch (selection.constructor) {
            case Subscription:
                const subscription = selection as Subscription;
                await CosmosClientAdapter.promptCheck(
                    `${SUBSCRIPTION_CHECK_MESSAGE} ${subscription.label}`,
                    subscription.label,
                    async () => await this.clearSubscription(subscription)
                );
                break;
            case CosmosAccount:
                const account = selection as CosmosAccount;
                await CosmosClientAdapter.promptCheck(
                    `${ACCOUNT_CHECK_MESSAGE} ${account.label}`,
                    account.label,
                    async () => await this.clearAccount(account)
                );
                break;
            case CosmosDatabase:
                const database = selection as CosmosDatabase;
                await CosmosClientAdapter.promptCheck(
                    `${DATABASE_CHECK_MESSAGE} ${database.label}`,
                    database.label,
                    async () => await this.clearDatabase(database)
                );
                break;
            case CosmosContainer:
                const container = selection as CosmosContainer;
                await CosmosClientAdapter.promptAccept(
                    `${CONTAINER_CHECK_MESSAGE} ${container.label}?`,
                    async () => await this.clearContainer(container)
                );
                break;
            default:
                break;
        }
    }

    private async clearSubscription(
        subscription: Subscription): Promise<void>
    {
        var accounts = this._azureResourceProvider.getRelatedCosmosAccounts(
            subscription.subscriptionId);
        if (accounts) {
            accounts.forEach(account => {
                this.clearAccount(account);
            });
        }
    }

    private async clearAccount(
        account: CosmosAccount): Promise<void> 
    {
        var databases = this._azureResourceProvider.getRelatedCosmosDatabases(
            account.accountId);
        if (databases) {
            databases.forEach(database => {
                this.clearDatabase(database);
            });
        }
    }

    private async clearDatabase(
        database: CosmosDatabase): Promise<void> 
    {
        var containers = this._azureResourceProvider.getRelatedCosmosContainers(
            database.databaseId);
        if (containers) {
            containers.forEach(container => {
                this.clearContainer(container);
            });
        }
    }

    private async clearContainer(
        container: CosmosContainer) : Promise<void>
    {
        var items = await container.container.items.readAll().fetchAll();
        items.resources.forEach(async item => {
            if (item.id) { await container.container.item(item.id).delete(); }
        });
    }

    private static async promptAccept(
        promptMessage: string,
        action: () => Promise<void>): Promise<void> 
    {
        await window
        .showInformationMessage(promptMessage, YES, NO)
        .then(async answer => {
            if (answer === YES) { await action(); }
        });
    }

    private static async promptCheck(
        prompt: string,
        check: string,
        action: () => Promise<void>): Promise<void> 
    {
        await window
        .showInputBox({
            prompt: prompt,
            placeHolder: check
        })
        .then(async text => {
            if (text === check) { await action(); }
        });
    }
}