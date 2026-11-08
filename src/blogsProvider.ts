import * as vscode from 'vscode';
import { BloggerService } from './bloggerService';
import { BloggerTreeItem } from './blogItem';

interface BloggerBlog {
    id?: string;
    name?: string;
    description?: string;
    published?: string | null;
    updated?: string | null;
    url?: string | null;
}

export class BloggerBlogsProvider implements vscode.TreeDataProvider<BloggerTreeItem> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    private blogs?: BloggerBlog[];
    private blogsPromise?: Promise<BloggerBlog[]>;
    private refreshGeneration = 0;
    
    constructor(private readonly bloggerService: BloggerService) {}

    getTreeItem(element: BloggerTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: BloggerTreeItem): Promise<BloggerTreeItem[]> {
        if (element) {
            return [];
        }

        try {
            const blogs = await this.getBlogs();
            const filteredBlogs = blogs;

            if (filteredBlogs.length === 0) {
                return [new vscode.TreeItem('No blogs found', vscode.TreeItemCollapsibleState.None)];
            }

            return filteredBlogs.map(blog => this.createBlogItem(blog));
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load Blogger blogs: ${error}`);
            return [];
        }
    }

    refresh(): void {
        this.refreshGeneration++;
        this.blogs = undefined;
        this.blogsPromise = undefined;
        this.onDidChangeTreeDataEmitter.fire(undefined);
    }

    private createCategory(label: string, contextValue: string): vscode.TreeItem {
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
        item.contextValue = contextValue;
        return item;
    }

    private createBlogItem(blog: BloggerBlog): BloggerTreeItem {
        const item = new BloggerTreeItem(blog.name || 'Untitled');
        item.id = blog.id;
        item.description = blog.description;
        item.tooltip = blog.url || blog.name || 'Blogger blog';
        item.Url = blog.url || undefined;
        item.contextValue = 'bloggerBlog';

        const selectedBlogId = vscode.workspace
            .getConfiguration('blogger')
            .get<string>('selectedBlogId');
        
        if (blog.id === selectedBlogId) {
            item.iconPath = new vscode.ThemeIcon('check');
        }

        return item;
    }

    private async getBlogs(): Promise<BloggerBlog[]> {
        if (this.blogs) {
            return this.blogs;
        }

        if (!this.blogsPromise) {
            const generation = this.refreshGeneration;
            const request = this.bloggerService.getBlogs().then(blogs => {
                if (generation === this.refreshGeneration) {
                    this.blogs = blogs;
                }
                return blogs;
            }).catch(error => {
                if (generation === this.refreshGeneration) {
                    this.blogsPromise = undefined;
                }
                throw error;
            });
            this.blogsPromise = request;
        }

        return this.blogsPromise;
    }
}
