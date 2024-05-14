import { window, QuickPickItem, Uri } from 'vscode';
import { join } from 'path';
import { VSCodeAzureSubscriptionProvider, getUnauthenticatedTenants, signInToTenant } from "@microsoft/vscode-azext-azureauth";

export class AzureCredentialProvider {
    public readonly _subscriptionProvider: VSCodeAzureSubscriptionProvider;

    constructor(subscriptionProvider: VSCodeAzureSubscriptionProvider) {
        this._subscriptionProvider = subscriptionProvider;
    }

    public async signIn(): Promise<boolean> 
    {
        let quickPickItems = await this._getAuthenticatedTenants();
        const unauthenticatedTenants = await getUnauthenticatedTenants(this._subscriptionProvider);
        if (unauthenticatedTenants.length > 0) {
            quickPickItems = [...quickPickItems, new UnauthorizedTenantsQuickPickItem()];
        }
        return await window.showQuickPick(quickPickItems, {
            title: "Select Tenant",
            placeHolder: "Select a tenant to sign in to",
            matchOnDescription: true,
            canPickMany: false
        }).then(async (selectedItem) => {
            if (selectedItem === undefined) { return true; }
            switch (selectedItem.constructor) {
                case AzureTenentQuickPickItem:
                    var tenant = selectedItem as AzureTenentQuickPickItem;
                    return this._subscriptionProvider.signIn(tenant.description);
                case UnauthorizedTenantsQuickPickItem:
                    await signInToTenant(this._subscriptionProvider);
                    return true;
                default:
                    return false;
            }
        });
    }

    private async _getAuthenticatedTenants(): Promise<QuickPickItem[]> {
        return (await this._subscriptionProvider.getTenants())
            .filter(tenant => tenant.tenantId !== undefined && tenant.displayName !== undefined)
            .map(tenant => new AzureTenentQuickPickItem(tenant.tenantId!, tenant.displayName!));
    }
}

class AzureTenentQuickPickItem implements QuickPickItem {
    public readonly label: string;
    public readonly description: string;
    public readonly alwaysShow?: boolean | undefined;

    constructor(
        tenantId: string, 
        displayName: string) {
        this.label = displayName;
        this.description = tenantId;
        this.alwaysShow = true;
    }

    public readonly iconPath = {
        light: Uri.file(join(__filename, '..', 'resources', 'dark', 'tenant-icon.svg')),
        dark: Uri.file(join(__filename, '..', 'resources', 'light', 'tenant-icon.svg'))
    };
}

class UnauthorizedTenantsQuickPickItem implements QuickPickItem {
    public readonly label: string;
    public readonly detail: string;
    public readonly alwaysShow?: boolean | undefined;

    constructor() {
        this.label = "Unauthorized Tenants";
        this.detail = "Sign in to use these tenants";
        this.alwaysShow = true;
    }
}