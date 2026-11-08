import * as vscode from 'vscode';
import { BloggerService } from './bloggerService';
import { BloggerItemType, BloggerTreeItem } from './blogItem';

interface BloggerPost {
    id?: string;
    title?: string;
    published?: string | null;
    updated?: string | null;
    url?: string | null;
    status?: string | null;
    local?: boolean;
    localPublished?: boolean;
    localFilePath?: string;
}

export class BloggerPostsProvider implements vscode.TreeDataProvider<BloggerTreeItem> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    private posts?: BloggerPost[];
    private postsPromise?: Promise<BloggerPost[]>;
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

    getTreeItem(element: BloggerTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: BloggerTreeItem): Promise<BloggerTreeItem[]> {
        if (!element) {
            return [
                this.createCategory('Published Posts', 'publishedPosts'),
                this.createCategory('Draft Posts', 'draftPosts')
            ];
        }

        if (element.contextValue !== 'publishedPosts' && element.contextValue !== 'draftPosts') {
            return [];
        }

        try {
            const [localDrafts, localPublished] = await Promise.all([
                this.getLocalFiles(this.localDraftsUri, 'DRAFT'),
                this.getLocalFiles(this.localPublishedUri, 'LIVE')
            ]);
            let bloggerPosts: BloggerPost[];
            try {
                bloggerPosts = await this.getPosts();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to load Blogger posts: ${error}`);
                bloggerPosts = [];
            }
            const posts = [...bloggerPosts, ...localDrafts, ...localPublished];
            const isPublishedCategory = element.contextValue === 'publishedPosts';
            const filteredPosts = posts.filter(post => {
                const isPublished = post.status
                    ? post.status.toUpperCase() === 'LIVE'
                    : Boolean(post.published);
                return isPublished === isPublishedCategory;
            });

            if (filteredPosts.length === 0) {
                return [new BloggerTreeItem('No posts found')];
            }

            return filteredPosts.map(post => this.createPostItem(post));
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load local post drafts: ${error}`);
            return [];
        }
    }

    refresh(): void {
        this.refreshGeneration++;
        this.posts = undefined;
        this.postsPromise = undefined;
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
    ): Promise<BloggerPost[]> {
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

    private createPostItem(post: BloggerPost): BloggerTreeItem {
        const isPublished = post.status
            ? post.status.toUpperCase() === 'LIVE'
            : Boolean(post.published);
        const date = post.published || post.updated;
        const item = new BloggerTreeItem(post.title || 'Untitled');
        item.id = post.local ? undefined : post.id;
        item.description = `${isPublished ? 'Published' : 'Draft'}${date ? ` • ${new Date(date).toLocaleDateString()}` : ''}`;
        item.tooltip = post.url || post.title || 'Blogger post';
        item.Url = post.url || undefined;
        item.LocalFilePath = post.localFilePath;
        item.contextValue = post.local
            ? post.localPublished
                ? 'bloggerPost_localPublished'
                : 'bloggerPost_localDraft'
            : isPublished
                ? 'bloggerPost_published'
                : 'bloggerPost_draft';
        item.Type = BloggerItemType.Post;

        if (post.local) {
            item.iconPath = new vscode.ThemeIcon('cloud-upload');
            item.tooltip = post.localPublished
                ? 'Local copy — changes not saved to Blogger'
                : 'Local draft — not published to Blogger';
            if (post.localFilePath) {
                item.command = {
                    command: 'vscode.open',
                    title: 'Open Local Draft',
                    arguments: [vscode.Uri.file(post.localFilePath)]
                };
            }
        }

        return item;
    }

    private async getPosts(): Promise<BloggerPost[]> {
        if (this.posts) {
            return this.posts;
        }

        if (!this.postsPromise) {
            const generation = this.refreshGeneration;
            const request = this.bloggerService.getPosts().then(posts => {
                if (generation === this.refreshGeneration) {
                    this.posts = posts;
                }
                return posts;
            }).catch(error => {
                if (generation === this.refreshGeneration) {
                    this.postsPromise = undefined;
                }
                throw error;
            });
            this.postsPromise = request;
        }

        return this.postsPromise;
    }
}
