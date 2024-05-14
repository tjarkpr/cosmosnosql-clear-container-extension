import { 
  TreeDataProvider,
  TreeItemCollapsibleState,
  EventEmitter,
  Event,
  TreeItem
} from 'vscode';
import { LogError } from '../helper/vscode-helper';
import { join } from 'path';
import { CosmosClient, Database, Container } from "@azure/cosmos";
import { VSCodeAzureSubscriptionProvider } from "@microsoft/vscode-azext-azureauth";
import { CosmosDBManagementClient } from "@azure/arm-cosmosdb";
import { TokenCredential } from "@azure/identity";


const NOSQL_KIND: string = "GlobalDocumentDB";
const CREDENTIALS_NOT_FOUND: string = "Credentials not found";

export class AzureResourceProvider implements TreeDataProvider<AzureResource> {
  private _onDidChangeTreeData: EventEmitter<AzureResource | undefined> = new EventEmitter<AzureResource | undefined>();
  readonly onDidChangeTreeData: Event<AzureResource | undefined> = this._onDidChangeTreeData.event;

  private _cosmosAccounts: Map<string, CosmosAccount[]> = new Map<string, CosmosAccount[]>();
  private _cosmosDatabases: Map<string, CosmosDatabase[]> = new Map<string, CosmosDatabase[]>();
  private _cosmosContainers: Map<string, CosmosContainer[]> = new Map<string, CosmosContainer[]>();

  constructor(
    private _subscriptionProvider: VSCodeAzureSubscriptionProvider,
    private _credentials: Map<string, TokenCredential> | null = null
  ) {}

  public updateCredentials(
    _credentials: Map<string, TokenCredential> | null): void 
  { this._credentials = _credentials; }

  public getRelatedCosmosAccounts(
    subscriptionId: string): CosmosAccount[] | undefined 
  { return this._cosmosAccounts.get(subscriptionId); }

  public getRelatedCosmosDatabases(
    accountId: string): CosmosDatabase[] | undefined 
  { return this._cosmosDatabases.get(accountId); }

  public getRelatedCosmosContainers(
    databaseId: string): CosmosContainer[] | undefined 
  { return this._cosmosContainers.get(databaseId); }

  public refreshTree(): void 
  { this._onDidChangeTreeData.fire(undefined); }

  public refresh(
    element: AzureResource): void 
  {
    if (!(element instanceof CosmosContainer)) {
      this._onDidChangeTreeData.fire(element);
      return;
    }

    const container = element as CosmosContainer;
    const database = this._cosmosDatabases
      .get(container.accountId)
      ?.find(db => db.databaseId === container.databaseId);
    if (database) { this.refresh(database); }
  }

  public getTreeItem(
    element: AzureResource): TreeItem 
  { return element; }

  public getChildren(
    element?: AzureResource): Thenable<AzureResource[]> 
  {
    if (this._credentials === null) { return Promise.resolve([]); }

    if (element === undefined) {
      try {
        return this.getSubscriptions();
      } catch (error) {
        LogError(error);
        return Promise.resolve([new InsufficientPermission()]);
      }
    }
    switch (element.constructor) {
      case Subscription:
        const subscription = element as Subscription;
        try {
          return this.getCosmosAccounts(subscription);
        } catch (error) {
          LogError(error);
          return Promise.resolve([new InsufficientPermission()]);
        }
      case CosmosAccount:
        const account = element as CosmosAccount;
        try {
          return this.getCosmosDatabases(account);
        } catch (error) {
          LogError(error);
          return Promise.resolve([new InsufficientPermission()]);
        }
      case CosmosDatabase:
        const database = element as CosmosDatabase;
        try {
          return this.getCosmosContainers(database);
        }
        catch (error) {
          LogError(error);
          return Promise.resolve([new InsufficientPermission()]);
        }
      case CosmosContainer:
        return Promise.resolve([]);
      default:
        return Promise.resolve([]);
    }
  }

  private async getSubscriptions(): Promise<AzureResource[]> 
  {
    const _subscriptions = await this._subscriptionProvider.getSubscriptions();
    if (_subscriptions.length === 0) { return [new NoResourceFound()]; }

    let _result = new Array<Subscription>();
    for (const _subscription of _subscriptions) {
      if (_subscription.name && 
        _subscription.subscriptionId) 
      {
        const subscription = new Subscription(
          _subscription.name, 
          TreeItemCollapsibleState.Collapsed, 
          _subscription.subscriptionId)
        _result.push(subscription);
      }
    }
    return _result;
  }

  private async getCosmosAccounts(
    _subscription: Subscription): Promise<AzureResource[]> 
  {
    const _credential = this._credentials?.get(_subscription.subscriptionId);
    if (_credential === undefined) { throw Error(CREDENTIALS_NOT_FOUND); }
    const _cosmosClient = new CosmosDBManagementClient(_credential, _subscription.subscriptionId);
    let _result = new Array<CosmosAccount>();
    for await (const _account of _cosmosClient.databaseAccounts.list()) {
      if (_account.name && 
        _account.id && 
        _account.documentEndpoint && 
        _account.kind === NOSQL_KIND) 
      {
        const _resourceGroup = _account.id.split('/')[4];
        const account = new CosmosAccount(
          _account.name, 
          TreeItemCollapsibleState.Collapsed, 
          _account.name, 
          _resourceGroup, 
          _account.documentEndpoint, 
          _subscription.subscriptionId);
        _result.push(account);
      }
    }
    this._cosmosAccounts.set(_subscription.subscriptionId, _result);
    if (_result.length === 0) { return [new NoResourceFound()]; }
    return _result;
  }

  private async getCosmosDatabases(
    _account: CosmosAccount): Promise<AzureResource[]> 
  {
    const _credential = this._credentials?.get(_account.subscriptionId);
    if (_credential === undefined) { throw Error(CREDENTIALS_NOT_FOUND); }
    const _cosmosManagementClient = new CosmosDBManagementClient(_credential, _account.subscriptionId);
    const _keys = await _cosmosManagementClient.databaseAccounts.listKeys(_account.resourceGroupId, _account.accountId);
    const _cosmosClient = new CosmosClient({
      endpoint: _account.documentEndpoint,
      key: _keys.primaryMasterKey
    });

    const { resources: _databases } = await _cosmosClient.databases.readAll().fetchAll();
    if (_databases.length === 0) { return [new NoResourceFound()]; }
    const _results = _databases.map(_database => {
      var cosmosDatabase = new CosmosDatabase(
        _database.id, 
        TreeItemCollapsibleState.Collapsed, 
        _database.id,
        _account.accountId,
        _account.subscriptionId,
        _cosmosClient.database(_database.id));
      return cosmosDatabase;
    });
    this._cosmosDatabases.set(_account.accountId, _results);
    return _results;
  }

  private async getCosmosContainers(
    _database: CosmosDatabase): Promise<AzureResource[]> 
  {
    const { resources: _containers } = await _database.database.containers.readAll().fetchAll();
    let _result = new Array<CosmosContainer>();
    for await (const _container of _containers) {
      var containerClient = _database.database.container(_container.id)
      var cosmosContainer = new CosmosContainer(
        _container.id, 
        _container.id, 
        await containerClient.items.readAll().fetchAll().then(items => items.resources.length === 0),
        _database.databaseId, 
        _database.accountId, 
        _database.subscriptionId,
        containerClient);
        _result.push(cosmosContainer);
    }
    this._cosmosContainers.set(_database.databaseId, _result);
    if (_result.length === 0) { return [new NoResourceFound()]; }
    return _result;
  }
}

export class AzureResource extends TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
  }
}

export class Subscription extends AzureResource {
  constructor(
    public readonly label: string,
    public collapsibleState: TreeItemCollapsibleState,
    public readonly subscriptionId: string
  ) {
    super(label, collapsibleState);
    this.tooltip = `Azure Subscription: ${this.label}`;
  }

  iconPath = {
    light: join(__filename, '..', 'resources', 'dark', 'subscription-icon.svg'),
    dark: join(__filename, '..', 'resources', 'light', 'subscription-icon.svg')
  };
  contextValue = 'subscription';
}

export class CosmosAccount extends AzureResource {
  constructor(
    public readonly label: string,
    public collapsibleState: TreeItemCollapsibleState,
    public readonly accountId: string,
    public readonly resourceGroupId: string,
    public readonly documentEndpoint: string,
    public readonly subscriptionId: string
  ) {
    super(label, collapsibleState);
    this.tooltip = `Cosmos DB Account: ${this.label}`;
      this.iconPath = {
        light: join(__filename, '..', 'resources', 'dark', 'cosmos-account-icon.svg'),
        dark: join(__filename, '..', 'resources', 'light', 'cosmos-account-icon.svg')
      };
      this.contextValue = 'cosmosAccount';
  }
}

export class CosmosDatabase extends AzureResource {
  constructor(
    public readonly label: string,
    public collapsibleState: TreeItemCollapsibleState,
    public readonly databaseId: string,
    public readonly accountId: string,
    public readonly subscriptionId: string,
    public readonly database: Database
  ) {
    super(label, collapsibleState);
    this.tooltip = `Cosmos DB Database: ${this.label}`;
  }

  iconPath = {
    light: join(__filename, '..', 'resources', 'dark', 'cosmos-database-icon.svg'),
    dark: join(__filename, '..', 'resources', 'light', 'cosmos-database-icon.svg')
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
    public readonly collapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None
  ) {
    super(label, collapsibleState);
    this.tooltip = `Cosmos DB Container: ${this.label}`;
    if (this.isEmpty) {
      this.tooltip += ' (Empty)';
      this.description = '(Empty)';
      this.iconPath = {
        light: join(__filename, '..', 'resources', 'dark', 'cosmos-empty-container-icon.svg'),
        dark: join(__filename, '..', 'resources', 'light', 'cosmos-empty-container-icon.svg')
      };
      return;
    }
    this.iconPath = {
      light: join(__filename, '..', 'resources', 'dark', 'cosmos-full-container-icon.svg'),
      dark: join(__filename, '..', 'resources', 'light', 'cosmos-full-container-icon.svg')
    };
    this.contextValue = 'cosmosContainer';
  }
}

class NoResourceFound extends AzureResource {
  constructor() {
    super('No resources found', TreeItemCollapsibleState.None);
  }
  iconPath = {
    light: join(__filename, '..', 'resources', 'dark', 'warning-icon.svg'),
    dark: join(__filename, '..', 'resources', 'light', 'warning-icon.svg')
  };
}

class InsufficientPermission extends AzureResource {
  constructor() {
    super('Insufficient Permission', TreeItemCollapsibleState.None);
  }
  iconPath = {
    light: join(__filename, '..', 'resources', 'dark', 'warning-icon.svg'),
    dark: join(__filename, '..', 'resources', 'light', 'warning-icon.svg')
  };
}