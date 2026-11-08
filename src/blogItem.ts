import * as vscode from 'vscode';

export enum BloggerItemType {
    Post,
    Page
}

export class BloggerTreeItem extends vscode.TreeItem {
    Url?: string;
    Type?: BloggerItemType;
    LocalFilePath?: string;

    constructor(label: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
    }
}