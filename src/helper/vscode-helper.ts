import { commands, window } from 'vscode';

const UPDATE_VSCODE_CONTEXT_VALUE_COMMAND: string = "setContext"
const EXTENSION_NAME: string = "cosmosnosql-clear-container-extension"

export function UpdateVSCodeContextValue(_key: string, _value: any): void {
	commands.executeCommand(
		UPDATE_VSCODE_CONTEXT_VALUE_COMMAND,
		GetFullExtensionName(_key),
		_value);
}

export function LogError(_error: any): void {
	if (_error instanceof Error) {
		window.showErrorMessage(_error.message);
	}
	if (typeof _error === 'string') {
		window.showErrorMessage(_error);
	}
	console.error(_error);
}

export function GetFullExtensionName(_name: string): string {
	return EXTENSION_NAME + '.' + _name
}