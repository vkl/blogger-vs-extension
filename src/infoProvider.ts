import * as vscode from 'vscode';

export interface BloggerInfoField {
    label: string;
    value: string;
}

export class BloggerInfoProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    private fields: BloggerInfoField[] = [];
    private items: vscode.TreeItem[] = [];

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getParent(_element: vscode.TreeItem): vscode.TreeItem | undefined {
        return undefined;
    }

    getChildren(): vscode.TreeItem[] {
        if (this.fields.length === 0) {
            return [new vscode.TreeItem('Select Info on a Blogger post or page.')];
        }

        return this.items;
    }

    show(fields: BloggerInfoField[]): vscode.TreeItem | undefined {
        this.fields = fields;
        this.items = this.fields.map(({ label, value }) => {
            const item = new vscode.TreeItem(label);
            item.description = value;
            item.tooltip = `${label}: ${value}`;
            return item;
        });
        this.onDidChangeTreeDataEmitter.fire();
        return this.items[0];
    }

    clear(): void {
        this.fields = [];
        this.items = [];
        this.onDidChangeTreeDataEmitter.fire();
    }
}
