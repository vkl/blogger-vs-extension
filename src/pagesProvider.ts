import * as vscode from 'vscode';
import { BloggerService } from './bloggerService';
import { BloggerItemType, BloggerTreeItem } from './blogItem';

interface BloggerPage {
    id?: string;
    title?: string;
    published?: string | null;
    updated?: string | null;
    url?: string | null;
    status?: string;
    local?: boolean;
    localPublished?: boolean;
    localFilePath?: string;
}

export class BloggerPagesProvider implements vscode.TreeDataProvider<BloggerTreeItem> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    private pages?: BloggerPage[];
    private pagesPromise?: Promise<BloggerPage[]>;
    private refreshGeneration = 0;
    private localDraftsUri?: vscode.Uri;
    private localPublishedUri?: vscode.Uri;

    constructor(
        private readonly bloggerService: BloggerService,
        localDraftsUri?: vscode.Uri,
        localPublishedUri?: vscode.Uri
    ) {
        this.localDraftsUri = localDraftsUri;
        this.localPublishedUri = localPublishedUri;
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<BloggerTreeItem[]> {
        if (!element) {
            return [
                this.createCategory('Published Pages', 'publishedPages'),
                this.createCategory('Draft Pages', 'draftPages')
            ];
        }

        if (element.contextValue !== 'publishedPages' && element.contextValue !== 'draftPages') {
            return [];
        }

        try {
            const [localDrafts, localPublished] = await Promise.all([
                this.getLocalFiles(this.localDraftsUri, 'DRAFT'),
                this.getLocalFiles(this.localPublishedUri, 'LIVE')
            ]);
            let bloggerPages: BloggerPage[];
            try {
                bloggerPages = await this.getPages();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to load Blogger pages: ${error}`);
                bloggerPages = [];
            }
            const pages = [...bloggerPages, ...localDrafts, ...localPublished];
            const isPublishedCategory = element.contextValue === 'publishedPages';
            const expectedStatus = isPublishedCategory ? 'LIVE' : 'DRAFT';
            const filteredPages = pages.filter(page => page.status === expectedStatus);

            if (filteredPages.length === 0) {
                return [new vscode.TreeItem('No pages found', vscode.TreeItemCollapsibleState.None)];
            }

            return filteredPages.map(page => this.createPageItem(page));
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load local page drafts: ${error}`);
            return [];
        }
    }

    refresh(): void {
        this.refreshGeneration++;
        this.pages = undefined;
        this.pagesPromise = undefined;
        this.onDidChangeTreeDataEmitter.fire(undefined);
    }

    refreshLocal(): void {
        this.onDidChangeTreeDataEmitter.fire(undefined);
    }

    setLocalDirectories(draftsUri?: vscode.Uri, publishedUri?: vscode.Uri): void {
        this.localDraftsUri = draftsUri;
        this.localPublishedUri = publishedUri;
        this.refreshLocal();
    }

    private createCategory(label: string, contextValue: string): vscode.TreeItem {
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
        item.contextValue = contextValue;
        return item;
    }

    private async getLocalFiles(
        directoryUri: vscode.Uri | undefined,
        status: 'DRAFT' | 'LIVE'
    ): Promise<BloggerPage[]> {
        if (!directoryUri) {
            return [];
        }

        const entries = await vscode.workspace.fs.readDirectory(directoryUri);
        return entries
            .filter(([name, type]) => type === vscode.FileType.File && /\.html$/i.test(name))
            .map(([name]) => {
                const uri = vscode.Uri.joinPath(directoryUri, name);
                return {
                    title: name.replace(/\.html$/i, ''),
                    status,
                    local: true,
                    localPublished: status === 'LIVE',
                    localFilePath: uri.fsPath
                };
            });
    }

    private createPageItem(page: BloggerPage): BloggerTreeItem {
        const isPublished = page.status === 'LIVE';
        const date = page.published || page.updated;
        const item = new BloggerTreeItem(page.title || 'Untitled');
        item.id = page.localFilePath ? undefined : page.id;
        item.description = `${isPublished ? 'Published' : 'Draft'}${date ? ` • ${new Date(date).toLocaleDateString()}` : ''}`;
        item.tooltip = page.url || page.title || 'Blogger page';
        item.Url = page.url || undefined;
        item.contextValue = page.local
            ? page.localPublished
                ? 'bloggerPage_localPublished'
                : 'bloggerPage_localDraft'
            : isPublished
                ? 'bloggerPage_published'
                : 'bloggerPage_draft';
        item.Type = BloggerItemType.Page;
        item.LocalFilePath = page.localFilePath;

        if (page.local) {
            item.iconPath = new vscode.ThemeIcon('cloud-upload');
            item.tooltip = page.localPublished
                ? 'Local copy — changes not saved to Blogger'
                : 'Local draft — not saved to Blogger';
        }

        if (page.localFilePath) {
            item.command = {
                command: 'vscode.open',
                title: 'Open Local Draft',
                arguments: [vscode.Uri.file(page.localFilePath)]
            };
        }

        return item;
    }

    private async getPages(): Promise<BloggerPage[]> {
        if (this.pages) {
            return this.pages;
        }

        if (!this.pagesPromise) {
            const generation = this.refreshGeneration;
            const request = this.bloggerService.getPages().then(pages => {
                if (generation === this.refreshGeneration) {
                    this.pages = pages;
                }
                return pages;
            }).catch(error => {
                if (generation === this.refreshGeneration) {
                    this.pagesPromise = undefined;
                }
                throw error;
            });
            this.pagesPromise = request;
        }

        return this.pagesPromise;
    }
}
