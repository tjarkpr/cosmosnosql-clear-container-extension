import * as vscode from 'vscode';
import * as path from 'path';
import { CosmosClient, Database, Container } from "@azure/cosmos";
import { SubscriptionClient } from "@azure/arm-subscriptions";
import { CosmosDBManagementClient } from "@azure/arm-cosmosdb";
import { ChainedTokenCredential } from "@azure/identity";

export class AzureResourceProvider implements vscode.TreeDataProvider<AzureResource> {
  private _onDidChangeTreeData: vscode.EventEmitter<AzureResource | undefined> = new vscode.EventEmitter<AzureResource | undefined>();
  readonly onDidChangeTreeData: vscode.Event<AzureResource | undefined> = this._onDidChangeTreeData.event;

  private _cosmosAccounts: Map<string, CosmosAccount[]> = new Map<string, CosmosAccount[]>();
  private _cosmosDatabases: Map<string, CosmosDatabase[]> = new Map<string, CosmosDatabase[]>();
  private _cosmosContainers: Map<string, CosmosContainer[]> = new Map<string, CosmosContainer[]>();

  constructor(
    private credentials: ChainedTokenCredential | null = null
  ) {}


  public getRelatedCosmosAccounts(subscriptionId: string): CosmosAccount[] | undefined {
    return this._cosmosAccounts.get(subscriptionId);
  }

  public getRelatedCosmosDatabases(accountId: string): CosmosDatabase[] | undefined {
    return this._cosmosDatabases.get(accountId);
  }

  public getRelatedCosmosContainers(databaseId: string): CosmosContainer[] | undefined {
    return this._cosmosContainers.get(databaseId);
  }

  public updateCredentials(credentials: ChainedTokenCredential | null) {
    this.credentials = credentials;
  }

  public refreshTree(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  public refresh(element: AzureResource): void {
    if (element instanceof CosmosContainer) {
      var container = element as CosmosContainer;
      var database = this._cosmosDatabases.get(container.accountId)?.find(db => db.databaseId === container.databaseId);
      if (database) {
        this.refresh(database);
      }
      return;
    }
    this._onDidChangeTreeData.fire(element);
  }

  public getTreeItem(element: AzureResource): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: AzureResource): Thenable<AzureResource[]> {
    if (this.credentials === null) {
      vscode.window.showErrorMessage('Azure credentials not found. Please log in to Azure.');
      return Promise.resolve([]);
    }

    if (element === undefined) {
      try {
        return this.getSubscriptions();
      } catch (error) {
        this.logError(error);
        return Promise.resolve([new InsufficientPermission()]);
      }
    }
    switch (element.constructor) {
      case Subscription:
        var subscription = element as Subscription;
        try {
          return this.getCosmosAccounts(subscription);
        } catch (error) {
          this.logError(error);
          return Promise.resolve([new InsufficientPermission()]);
        }
      case CosmosAccount:
        var account = element as CosmosAccount;
        try {
          return this.getCosmosDatabases(account);
        } catch (error) {
          this.logError(error);
          return Promise.resolve([new InsufficientPermission()]);
        }
      case CosmosDatabase:
        var database = element as CosmosDatabase;
        try {
          return this.getCosmosContainers(database);
        }
        catch (error) {
          this.logError(error);
          return Promise.resolve([new InsufficientPermission()]);
        }
      case CosmosContainer:
        return Promise.resolve([]);
      default:
        return Promise.resolve([]);
    }
  }

  private logError(error: any) {
    if (error instanceof Error) {
      vscode.window.showErrorMessage(error.message);
    }
    if (typeof error === 'string') {
      vscode.window.showErrorMessage(error);
    }
    console.error(error);
  }

  private async getSubscriptions(): Promise<AzureResource[]> {
    var subscriptionClient = new SubscriptionClient(this.credentials!);
    var result = new Array<Subscription>();
    for await (var item of subscriptionClient.subscriptions.list()) {
      if (item.displayName && item.subscriptionId) {
        var subscription = new Subscription(
          item.displayName, 
          vscode.TreeItemCollapsibleState.Collapsed, 
          item.subscriptionId)
        result.push(subscription);
      }
    }
    if (result.length === 0) {
      return [new NoResourceFound()];
    }
    return result;
  }

  private async getCosmosAccounts(
    subscription: Subscription): Promise<AzureResource[]> {
    var cosmosClient = new CosmosDBManagementClient(this.credentials!, subscription.subscriptionId);
    var result = new Array<CosmosAccount>();
    for await (var item of cosmosClient.databaseAccounts.list()) {
      if (item.name && item.id && item.documentEndpoint && item.kind === 'GlobalDocumentDB') {
        var resourceGroup = item.id.split('/')[4];
        var account = new CosmosAccount(
          item.name, 
          vscode.TreeItemCollapsibleState.Collapsed, 
          item.name, 
          resourceGroup, 
          item.documentEndpoint, 
          subscription.subscriptionId);
        result.push(account);
      }
    }
    this._cosmosAccounts.set(subscription.subscriptionId, result);
    if (result.length === 0) {
      return [new NoResourceFound()];
    }
    return result;
  }

  private async getCosmosDatabases(
    account: CosmosAccount): Promise<AzureResource[]> {
    var cosmosManagementClient = new CosmosDBManagementClient(this.credentials!, account.subscriptionId);
    var keys = await cosmosManagementClient.databaseAccounts.listKeys(account.resourceGroupId, account.accountId);
    var cosmosClient = new CosmosClient({
      endpoint: account.documentEndpoint,
      key: keys.primaryMasterKey
    });

    const { resources: databases } = await cosmosClient.databases.readAll().fetchAll();
    if (databases.length === 0) {
      return [new NoResourceFound()];
    }
    var results = databases.map(db => {
      var cosmosDatabase = new CosmosDatabase(
        db.id, 
        vscode.TreeItemCollapsibleState.Collapsed, 
        db.id,
        account.accountId,
        account.subscriptionId,
        cosmosClient.database(db.id));
      return cosmosDatabase;
    });
    this._cosmosDatabases.set(account.accountId, results);
    return results;
  }

  private async getCosmosContainers(
    database: CosmosDatabase): Promise<AzureResource[]> {
    const { resources: containers } = await database.database.containers.readAll().fetchAll();
    var result = new Array<CosmosContainer>();
    for await (var container of containers) {
      var containerClient = database.database.container(container.id)
      var cosmosContainer = new CosmosContainer(
        container.id, 
        container.id, 
        await containerClient.items.readAll().fetchAll().then(items => items.resources.length === 0),
        database.databaseId, 
        database.accountId, 
        database.subscriptionId,
        containerClient);
      result.push(cosmosContainer);
    }
    this._cosmosContainers.set(database.databaseId, result);
    if (result.length === 0) {
      return [new NoResourceFound()];
    }
    return result;
  }
}

export class AzureResource extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
  }
}

export class Subscription extends AzureResource {
  constructor(
    public readonly label: string,
    public collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly subscriptionId: string
  ) {
    super(label, collapsibleState);
    this.tooltip = `Azure Subscription: ${this.label}`;
  }

  iconPath = {
    light: path.join(__filename, '..', '..', '..', 'resources', 'dark', 'subscription-icon.svg'),
    dark: path.join(__filename, '..', '..', '..', 'resources', 'light', 'subscription-icon.svg')
  };
  contextValue = 'subscription';
}

export class CosmosAccount extends AzureResource {
  constructor(
    public readonly label: string,
    public collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly accountId: string,
    public readonly resourceGroupId: string,
    public readonly documentEndpoint: string,
    public readonly subscriptionId: string
  ) {
    super(label, collapsibleState);
    this.tooltip = `Cosmos DB Account: ${this.label}`;
      this.iconPath = {
        light: path.join(__filename, '..', '..', '..', 'resources', 'dark', 'cosmos-account-icon.svg'),
        dark: path.join(__filename, '..', '..', '..', 'resources', 'light', 'cosmos-account-icon.svg')
      };
      this.contextValue = 'cosmosAccount';
  }
}

export class CosmosDatabase extends AzureResource {
  constructor(
    public readonly label: string,
    public collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly databaseId: string,
    public readonly accountId: string,
    public readonly subscriptionId: string,
    public readonly database: Database
  ) {
    super(label, collapsibleState);
    this.tooltip = `Cosmos DB Database: ${this.label}`;
  }

  iconPath = {
    light: path.join(__filename, '..', '..', '..', 'resources', 'dark', 'cosmos-database-icon.svg'),
    dark: path.join(__filename, '..', '..', '..', 'resources', 'light', 'cosmos-database-icon.svg')
  };
  contextValue = 'cosmosDatabase';
}

export class CosmosContainer extends AzureResource {
  constructor(
    public readonly label: string,
    public readonly containerId: string,
    public readonly isEmpty: boolean,
    public readonly databaseId: string,
    public readonly accountId: string,
    public readonly subscriptionId: string,
    public readonly container: Container,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    super(label, collapsibleState);
    this.tooltip = `Cosmos DB Container: ${this.label}`;
    if (this.isEmpty) {
      this.tooltip += ' (Empty)';
      this.description = '(Empty)';
      this.iconPath = {
        light: path.join(__filename, '..', '..', '..', 'resources', 'dark', 'cosmos-empty-container-icon.svg'),
        dark: path.join(__filename, '..', '..', '..', 'resources', 'light', 'cosmos-empty-container-icon.svg')
      };
      return;
    }
    this.iconPath = {
      light: path.join(__filename, '..', '..', '..', 'resources', 'dark', 'cosmos-full-container-icon.svg'),
      dark: path.join(__filename, '..', '..', '..', 'resources', 'light', 'cosmos-full-container-icon.svg')
    };
    this.contextValue = 'cosmosContainer';
  }
}

class NoResourceFound extends AzureResource {
  constructor() {
    super('No resources found', vscode.TreeItemCollapsibleState.None);
  }
  iconPath = {
    light: path.join(__filename, '..', '..', '..', 'resources', 'dark', 'warning-icon.svg'),
    dark: path.join(__filename, '..', '..', '..', 'resources', 'light', 'warning-icon.svg')
  };
}

class InsufficientPermission extends AzureResource {
  constructor() {
    super('Insufficient Permission', vscode.TreeItemCollapsibleState.None);
  }
  iconPath = {
    light: path.join(__filename, '..', '..', '..', 'resources', 'dark', 'warning-icon.svg'),
    dark: path.join(__filename, '..', '..', '..', 'resources', 'light', 'warning-icon.svg')
  };
}