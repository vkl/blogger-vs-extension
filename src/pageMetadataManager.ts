import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface PageMetadata {
    pageId?: string;
    blogId?: string;
    title?: string;
    published?: boolean;
    isDraft?: boolean;
    url?: string;
    lastModified?: string;
    createdAt?: string;
    filePath?: string;
}

export interface PageMetadataStorage {
    [filePath: string]: PageMetadata;
}

export class PageMetadataManager {
    private metadataFile: string;
    private metadata: PageMetadataStorage = {};

    constructor(private context: vscode.ExtensionContext) {
        this.metadataFile = path.join(context.globalStorageUri?.fsPath || context.extensionPath, 'pageMetadata.json');
        this.loadMetadata();
    }

    private async ensureStorageDirectory(): Promise<void> {
        const storageDir = path.dirname(this.metadataFile);
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }
    }

    private async loadMetadata(): Promise<void> {
        try {
            await this.ensureStorageDirectory();
            if (fs.existsSync(this.metadataFile)) {
                const data = fs.readFileSync(this.metadataFile, 'utf8');
                this.metadata = JSON.parse(data);
            }
        } catch (error) {
            console.error('Failed to load page metadata:', error);
            this.metadata = {};
        }
    }

    private async saveMetadata(): Promise<void> {
        try {
            await this.ensureStorageDirectory();
            fs.writeFileSync(this.metadataFile, JSON.stringify(this.metadata, null, 2), 'utf8');
        } catch (error) {
            console.error('Failed to save page metadata:', error);
        }
    }

    async getPageMetadata(filePath: string): Promise<PageMetadata | null> {
        const normalizedPath = this.normalizePath(filePath);
        return this.metadata[normalizedPath] || null;
    }

    async setPageMetadata(filePath: string, metadata: PageMetadata): Promise<void> {
        const normalizedPath = this.normalizePath(filePath);
        this.metadata[normalizedPath] = {
            ...this.metadata[normalizedPath],
            ...metadata,
            filePath: normalizedPath,
            lastModified: new Date().toISOString()
        };

        if (!this.metadata[normalizedPath].createdAt) {
            this.metadata[normalizedPath].createdAt = new Date().toISOString();
        }

        await this.saveMetadata();
    }

    async updatePageMetadata(filePath: string, updates: Partial<PageMetadata>): Promise<void> {
        const normalizedPath = this.normalizePath(filePath);
        const existing = this.metadata[normalizedPath] || {};
        await this.setPageMetadata(filePath, { ...existing, ...updates });
    }

    async removePageMetadata(filePath: string): Promise<void> {
        const normalizedPath = this.normalizePath(filePath);
        delete this.metadata[normalizedPath];
        await this.saveMetadata();
    }

    async getAllPageMetadata(): Promise<PageMetadataStorage> {
        return { ...this.metadata };
    }

    async getPagesForBlog(blogId: string): Promise<PageMetadata[]> {
        return Object.values(this.metadata).filter(page => page.blogId === blogId);
    }

    async isPagePublished(filePath: string): Promise<boolean> {
        const metadata = await this.getPageMetadata(filePath);
        return metadata?.published === true && !metadata?.isDraft;
    }

    async hasPageId(filePath: string): Promise<boolean> {
        const metadata = await this.getPageMetadata(filePath);
        return !!metadata?.pageId;
    }

    async getPageUrl(filePath: string): Promise<string | null> {
        const metadata = await this.getPageMetadata(filePath);
        return metadata?.url || null;
    }

    private normalizePath(filePath: string): string {
        return path.resolve(filePath).replace(/\\/g, '/');
    }

    async cleanupMetadata(): Promise<void> {
        let hasChanges = false;

        for (const filePath of Object.keys(this.metadata)) {
            if (!fs.existsSync(filePath)) {
                delete this.metadata[filePath];
                hasChanges = true;
            }
        }

        if (hasChanges) {
            await this.saveMetadata();
        }
    }

    async exportMetadata(): Promise<string> {
        return JSON.stringify(this.metadata, null, 2);
    }

    async importMetadata(data: string): Promise<void> {
        try {
            const imported = JSON.parse(data) as PageMetadataStorage;
            this.metadata = { ...this.metadata, ...imported };
            await this.saveMetadata();
        } catch (error) {
            throw new Error(`Failed to import page metadata: ${error}`);
        }
    }

    async markAsUnpublished(filePath: string, newPageId?: string): Promise<void> {
        const updates: Partial<PageMetadata> = {
            published: false,
            isDraft: true
        };

        if (newPageId) {
            updates.pageId = newPageId;
        }

        await this.updatePageMetadata(filePath, updates);
    }

    async markAsDeleted(filePath: string): Promise<void> {
        await this.updatePageMetadata(filePath, {
            published: false,
            isDraft: false,
            pageId: undefined,
            url: undefined
        });
    }

    async getPageStatus(filePath: string): Promise<'published' | 'draft' | 'not-published' | 'deleted'> {
        const metadata = await this.getPageMetadata(filePath);

        if (!metadata || !metadata.pageId) {
            return 'not-published';
        }

        if (metadata.published === true && !metadata.isDraft) {
            return 'published';
        }

        if (metadata.isDraft === true || metadata.published === false) {
            return 'draft';
        }

        return 'not-published';
    }
}