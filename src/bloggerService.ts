import { google } from 'googleapis';
import { AuthManager } from './authManager';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './utils';

export interface UserInfo {
    id: string;
    displayName: string;
}

export interface BlogInfo {
    id: string;
    name: string;
    url: string;
}

export interface DriveFolderInfo {
    id: string;
    name: string;
}

export interface DriveFolderContentInfo {
    id: string;
    name: string;
    mimeType: string;
    webViewLink?: string | null;
}

export interface BlogDetails extends BlogInfo {
    description?: string | null;
    published?: string | null;
    updated?: string | null;
    posts?: { totalItems?: number | null } | null;
    pages?: { totalItems?: number | null } | null;
    locale?: { language?: string | null; country?: string | null } | null;
}

export interface PostData {
    title: string;
    content: string;
    labels: string[];
    isDraft: boolean;
}

export interface PostResponse {
    postId: string;
    url: string | null;
}

export interface ImageUploadResult {
    originalPath: string;
    driveUrl: string;
    fileName: string;
    fileId: string;
}

export function isNotFoundError(error: unknown): boolean {
    let current: unknown = error;
    while (current && typeof current === 'object') {
        const candidate = current as {
            code?: number | string;
            status?: number;
            response?: { status?: number };
            cause?: unknown;
            message?: string;
        };
        if (
            candidate.code === 404
            || candidate.code === '404'
            || candidate.status === 404
            || candidate.response?.status === 404
            || candidate.message?.includes('Requested entity was not found')
        ) {
            return true;
        }
        current = candidate.cause;
    }
    return false;
}

export class BloggerService {
    constructor(private authManager: AuthManager) {}

    async getSelf(): Promise<UserInfo> {
        try {
            const auth = await this.authManager.getAuthenticatedClient();
            const blogger = google.blogger({ version: 'v3', auth });

            Logger.debug('Blogger API: users.get');
            const response = await blogger.users.get(({
                userId: 'self'
            }));

            return {
                id: response.data.id!,
                displayName: response.data.displayName!
            };
        } catch (error) {
            throw new Error(`Failed to fetch user: ${error}`);
        }
    }

    async getBlogs(): Promise<BlogInfo[]> {
        try {
            const auth = await this.authManager.getAuthenticatedClient();
            const blogger = google.blogger({ version: 'v3', auth });

            Logger.debug('Blogger API: blogs.listByUser');
            const response = await blogger.blogs.listByUser({
                userId: 'self'
            });

            return response.data.items?.map(blog => ({
                id: blog.id!,
                name: blog.name!,
                url: blog.url!
            })) || [];
        } catch (error) {
            throw new Error(`Failed to fetch blogs: ${error}`);
        }
    }

    async getFolders(): Promise<DriveFolderInfo[]> {
        try {
            const auth = await this.authManager.getAuthenticatedClient();
            const drive = google.drive({ version: 'v3', auth });
            const folders: DriveFolderInfo[] = [];
            let pageToken: string | undefined;

            do {
                Logger.debug('Google Drive API: files.list (folders)');
                const response = await drive.files.list({
                    q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
                    fields: 'nextPageToken, files(id, name)',
                    orderBy: 'name',
                    pageSize: 1000,
                    pageToken
                });

                for (const folder of response.data.files ?? []) {
                    if (folder.id && folder.name) {
                        folders.push({ id: folder.id, name: folder.name });
                    }
                }

                pageToken = response.data.nextPageToken ?? undefined;
            } while (pageToken);

            return folders;
        } catch (error) {
            throw new Error(`Failed to fetch Google Drive folders: ${error}`);
        }
    }

    async getFolderContent(folderPath: string): Promise<DriveFolderContentInfo[] | undefined> {
        try {
            const folderNames = folderPath.split('/').map(name => name.trim()).filter(Boolean);
            if (folderNames.length === 0) {
                return undefined;
            }

            const auth = await this.authManager.getAuthenticatedClient();
            const drive = google.drive({ version: 'v3', auth });
            let parentId: string | undefined;

            for (const folderName of folderNames) {
                const escapedName = folderName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                const response = await drive.files.list({
                    q: `name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${parentId ? ` and '${parentId}' in parents` : " and 'root' in parents"}`,
                    fields: 'files(id, name)',
                    pageSize: 100
                });
                const folder = response.data.files?.find(item => item.id);
                if (!folder?.id) {
                    return undefined;
                }
                parentId = folder.id;
            }

            const contents: DriveFolderContentInfo[] = [];
            let pageToken: string | undefined;
            do {
                Logger.debug(`Google Drive API: files.list (folder contents), folderId=${parentId}`);
                const response = await drive.files.list({
                    q: `'${parentId}' in parents and trashed = false`,
                    fields: 'nextPageToken, files(id, name, mimeType, webViewLink)',
                    orderBy: 'name',
                    pageSize: 1000,
                    pageToken
                });
                for (const file of response.data.files ?? []) {
                    if (file.id && file.name && file.mimeType) {
                        contents.push({
                            id: file.id,
                            name: file.name,
                            mimeType: file.mimeType,
                            webViewLink: file.webViewLink
                        });
                    }
                }
                pageToken = response.data.nextPageToken ?? undefined;
            } while (pageToken);

            return contents;
        } catch (error) {
            throw new Error(`Failed to list Google Drive folder contents: ${error}`, { cause: error });
        }
    }

    async getBlog(blogId: string): Promise<BlogDetails> {
        try {
            const auth = await this.authManager.getAuthenticatedClient();
            const blogger = google.blogger({ version: 'v3', auth });

            Logger.debug(`Blogger API: blogs.get, blogId=${blogId}`);
            const response = await blogger.blogs.get({ blogId });
            if (!response.data.id || !response.data.name || !response.data.url) {
                throw new Error('Blogger returned incomplete blog details.');
            }
            return response.data as BlogDetails;
        } catch (error) {
            throw new Error(`Failed to fetch blog: ${error}`);
        }
    }

    async publishPost(postData: PostData): Promise<PostResponse> {
        try {
            const auth = await this.authManager.getAuthenticatedClient();
            const blogger = google.blogger({ version: 'v3', auth });

            const config = vscode.workspace.getConfiguration('blogger');
            const blogId = config.get<string>('selectedBlogId');

            if (!blogId) {
                throw new Error('No blog selected. Please select a blog first.');
            }

            const post = {
                title: postData.title,
                content: postData.content,
                labels: postData.labels.length > 0 ? postData.labels : undefined
            };

            let response;
            if (postData.isDraft) {
                Logger.debug(`Blogger API: posts.insert (draft), blogId=${blogId}`);
                response = await blogger.posts.insert({
                    blogId,
                    isDraft: true,
                    requestBody: post
                });
            } else {
                Logger.debug(`Blogger API: posts.insert (publish), blogId=${blogId}`);
                response = await blogger.posts.insert({
                    blogId,
                    requestBody: post
                });
            }

            return {
                postId: response.data.id!,
                url: response.data.url || null
            };
        } catch (error) {
            throw new Error(`Failed to publish post: ${error}`, { cause: error });
        }
    }

    async createPage(title: string, content: string, isDraft: boolean): Promise<{ pageId: string; url: string | null }> {
        try {
            const auth = await this.authManager.getAuthenticatedClient();
            const blogger = google.blogger({ version: 'v3', auth });
            const blogId = vscode.workspace.getConfiguration('blogger').get<string>('selectedBlogId');

            if (!blogId) {
                throw new Error('No blog selected. Please select a blog first.');
            }

            Logger.debug(`Blogger API: pages.insert, blogId=${blogId}, isDraft=${isDraft}`);
            const response = await blogger.pages.insert({
                blogId,
                isDraft,
                requestBody: { title, content }
            });

            return {
                pageId: response.data.id!,
                url: response.data.url || null
            };
        } catch (error) {
            throw new Error(`Failed to create page: ${error}`, { cause: error });
        }
    }

    async publishDraftPost(postId: string): Promise<PostResponse> {
        try {
            const auth = await this.authManager.getAuthenticatedClient();
            const blogger = google.blogger({ version: 'v3', auth });
            const blogId = vscode.workspace.getConfiguration('blogger').get<string>('selectedBlogId');

            if (!blogId) {
                throw new Error('No blog selected. Please select a blog first.');
            }

            Logger.debug(`Blogger API: posts.publish, blogId=${blogId}, postId=${postId}`);
            const response = await blogger.posts.publish({ blogId, postId });
            return {
                postId: response.data.id || postId,
                url: response.data.url || null
            };
        } catch (error) {
            throw new Error(`Failed to publish post: ${error}`, { cause: error });
        }
    }

    async publishDraftPage(pageId: string): Promise<{ pageId: string; url: string | null }> {
        try {
            const auth = await this.authManager.getAuthenticatedClient();
            const blogger = google.blogger({ version: 'v3', auth });
            const blogId = vscode.workspace.getConfiguration('blogger').get<string>('selectedBlogId');

            if (!blogId) {
                throw new Error('No blog selected. Please select a blog first.');
            }

            Logger.debug(`Blogger API: pages.publish, blogId=${blogId}, pageId=${pageId}`);
            const response = await blogger.pages.publish({ blogId, pageId });
            return {
                pageId: response.data.id || pageId,
                url: response.data.url || null
            };
        } catch (error) {
            throw new Error(`Failed to publish page: ${error}`, { cause: error });
        }
    }

    async updatePost(postId: string, postData: PostData): Promise<string | null> {
        try {
            const auth = await this.authManager.getAuthenticatedClient();
            const blogger = google.blogger({ version: 'v3', auth });

            const config = vscode.workspace.getConfiguration('blogger');
            const blogId = config.get<string>('selectedBlogId');

            if (!blogId) {
                throw new Error('No blog selected. Please select a blog first.');
            }

            const post = {
                title: postData.title,
                content: postData.content,
                labels: postData.labels.length > 0 ? postData.labels : undefined
            };

            // For draft posts, we need to handle them differently
            let currentPost;
            let currentStatus = 'UNKNOWN';
            
            try {
                // Try to get the post (this might fail for drafts in some cases)
                Logger.debug(`Blogger API: posts.get, blogId=${blogId}, postId=${postId}`);
                currentPost = await blogger.posts.get({
                    blogId,
                    postId
                });
                currentStatus = currentPost.data.status || 'UNKNOWN';
            } catch (getError) {
                console.log('Could not get post status, trying alternative approach:', getError);
                
                // If we can't get the post, try to get it from the drafts list
                try {
                    Logger.debug(`Blogger API: posts.list (draft fallback), blogId=${blogId}`);
                    const draftsResponse = await blogger.posts.list({
                        blogId,
                        status: ['draft'],
                        maxResults: this.getMaxResults()
                    });
                    
                    const draftPost = draftsResponse.data.items?.find(p => p.id === postId);
                    if (draftPost) {
                        currentStatus = 'DRAFT';
                        currentPost = { data: draftPost };
                    }
                } catch (draftsError) {
                    console.log('Could not get drafts either:', draftsError);
                }
            }

            // If we want to publish a draft, use a different approach
            if (!postData.isDraft && currentStatus === 'DRAFT') {
                // For drafts, we need to update and then publish
                try {
                    // First update the content
                    Logger.debug(`Blogger API: posts.update (before publish), blogId=${blogId}, postId=${postId}`);
                    await blogger.posts.update({
                        blogId,
                        postId,
                        requestBody: post
                    });

                    // Then publish it
                    Logger.debug(`Blogger API: posts.publish, blogId=${blogId}, postId=${postId}`);
                    const publishResponse = await blogger.posts.publish({
                        blogId,
                        postId
                    });
                    
                    return publishResponse.data.url || null;
                } catch (publishError) {
                    console.log('Publish failed, trying to update content directly:', publishError);
                    
                    // If publish fails, just try a regular update
                    Logger.debug(`Blogger API: posts.update (publish fallback), blogId=${blogId}, postId=${postId}`);
                    const updateResponse = await blogger.posts.update({
                        blogId,
                        postId,
                        requestBody: post
                    });
                    
                    return updateResponse.data.url || null;
                }
            } else {
                // Regular update for published posts or saving as draft
                Logger.debug(`Blogger API: posts.update, blogId=${blogId}, postId=${postId}`);
                const updateResponse = await blogger.posts.update({
                    blogId,
                    postId,
                    requestBody: post
                });

                // Handle reverting published post to draft
                if (currentStatus === 'LIVE' && postData.isDraft) {
                    try {
                        Logger.debug(`Blogger API: posts.revert, blogId=${blogId}, postId=${postId}`);
                        await blogger.posts.revert({
                            blogId,
                            postId
                        });
                    } catch (revertError) {
                        console.log('Revert failed:', revertError);
                    }
                }

                return updateResponse.data.url || null;
            }
        } catch (error) {
            throw new Error(`Failed to update post: ${error}`);
        }
    }

    async updateDraftPost(postId: string, title: string, content: string, labels: string[] = []): Promise<string | null> {
        try {
            const auth = await this.authManager.getAuthenticatedClient();
            const blogger = google.blogger({ version: 'v3', auth });
            const blogId = vscode.workspace.getConfiguration('blogger').get<string>('selectedBlogId');

            if (!blogId) {
                throw new Error('No blog selected. Please select a blog first.');
            }

            Logger.debug(`Blogger API: posts.update (draft), blogId=${blogId}, postId=${postId}`);
            const response = await blogger.posts.update({
                blogId,
                postId,
                publish: false,
                requestBody: {
                    id: postId,
                    title,
                    content,
                    labels: labels.length > 0 ? labels : undefined
                }
            });

            return response.data.url || null;
        } catch (error) {
            throw new Error(`Failed to update Blogger draft post: ${error}`, { cause: error });
        }
    }

    async updatePostLabels(blogId: string, postId: string, labels: string[]): Promise<void> {
        try {
            const auth = await this.authManager.getAuthenticatedClient();
            const blogger = google.blogger({ version: 'v3', auth });

            Logger.debug(`Blogger API: posts.patch (labels), blogId=${blogId}, postId=${postId}`);
            await blogger.posts.patch({
                blogId,
                postId,
                requestBody: { labels }
            });
        } catch (error) {
            throw new Error(`Failed to update Blogger post labels: ${error}`);
        }
    }

    async updatePage(pageId: string, title: string, content: string): Promise<string | null> {
        try {
            const auth = await this.authManager.getAuthenticatedClient();
            const blogger = google.blogger({ version: 'v3', auth });
            const blogId = vscode.workspace.getConfiguration('blogger').get<string>('selectedBlogId');

            if (!blogId) {
                throw new Error('No blog selected. Please select a blog first.');
            }

            Logger.debug(`Blogger API: pages.update, blogId=${blogId}, pageId=${pageId}`);
            const response = await blogger.pages.update({
                blogId,
                pageId,
                requestBody: { title, content }
            });
            return response.data.url || null;
        } catch (error) {
            throw new Error(`Failed to update page: ${error}`, { cause: error });
        }
    }

    async getPosts(blogId?: string): Promise<any[]> {
        try {
            const auth = await this.authManager.getAuthenticatedClient();
            const blogger = google.blogger({ version: 'v3', auth });

            const config = vscode.workspace.getConfiguration('blogger');
            const selectedBlogId = blogId || config.get<string>('selectedBlogId');

            if (!selectedBlogId) {
                throw new Error('No blog selected. Please select a blog first.');
            }

            Logger.debug(`Blogger API: posts.list, blogId=${selectedBlogId}`);
            const response = await blogger.posts.list({
                blogId: selectedBlogId,
                maxResults: this.getMaxResults(),
                status: ['live', 'draft']
            });

            return response.data.items || [];
        } catch (error) {
            throw new Error(`Failed to fetch posts: ${error}`);
        }
    }

    async getPost(blogId?: string, postId?: string): Promise<any> {
        try {
            const auth = await this.authManager.getAuthenticatedClient();
            const blogger = google.blogger({ version: 'v3', auth });

            const config = vscode.workspace.getConfiguration('blogger');
            const selectedBlogId = blogId || config.get<string>('selectedBlogId');

            if (!selectedBlogId || !postId) {
                throw new Error('No blog or post selected. Please select a blog and post first.');
            }

            Logger.debug(`Blogger API: posts.get, blogId=${selectedBlogId}, postId=${postId}`);
            const response = await blogger.posts.get({
                blogId: selectedBlogId,
                postId: postId,
                fetchBody: true,
                view: 'ADMIN'
            });

            return response.data || "";
        } catch (error) {
            throw new Error(`Failed to fetch post: ${error}`, { cause: error });
        }
    }

    async getPage(blogId?: string, pageId?: string): Promise<any> {
        try {
            const auth = await this.authManager.getAuthenticatedClient();
            const blogger = google.blogger({ version: 'v3', auth });

            const config = vscode.workspace.getConfiguration('blogger');
            const selectedBlogId = blogId || config.get<string>('selectedBlogId');

            if (!selectedBlogId || !pageId) {
                throw new Error('No blog or page selected. Please select a blog and page first.');
            }

            Logger.debug(`Blogger API: pages.get, blogId=${selectedBlogId}, pageId=${pageId}`);
            const response = await blogger.pages.get({
                blogId: selectedBlogId,
                pageId: pageId,
                view: 'ADMIN'
            });

            return response.data || "";
        } catch (error) {
            throw new Error(`Failed to fetch page: ${error}`, { cause: error });
        }
    }

    async getPages(blogId?: string): Promise<any[]> {
        try {
            const auth = await this.authManager.getAuthenticatedClient();
            const blogger = google.blogger({ version: 'v3', auth });

            const config = vscode.workspace.getConfiguration('blogger');
            const selectedBlogId = blogId || config.get<string>('selectedBlogId');

            if (!selectedBlogId) {
                throw new Error('No blog selected. Please select a blog first.');
            }

            Logger.debug(`Blogger API: pages.list, blogId=${selectedBlogId}`);
            const response = await blogger.pages.list({
                blogId: selectedBlogId,
                maxResults: Math.min(this.getMaxResults(), 50),
                status: ['DRAFT', 'LIVE'],
            });

            return response.data.items || [];
        } catch (error) {
            throw new Error(`Failed to fetch pages: ${error}`);
        }
    }

    async unpublishPost(postId: string): Promise<PostResponse> {
        try {
            const auth = await this.authManager.getAuthenticatedClient();
            const blogger = google.blogger({ version: 'v3', auth });
            const blogId = vscode.workspace.getConfiguration('blogger').get<string>('selectedBlogId');

            if (!blogId) {
                throw new Error('No blog selected. Please select a blog first.');
            }

            Logger.debug(`Blogger API: posts.revert, blogId=${blogId}, postId=${postId}`);
            const response = await blogger.posts.revert({ blogId, postId });

            return {
                postId: response.data.id || postId,
                url: response.data.url || null
            };
        } catch (error) {
            throw new Error(`Failed to unpublish post: ${error}`);
        }
    }

    async unpublishPage(pageId: string): Promise<{ pageId: string; url: string | null }> {
        try {
            const auth = await this.authManager.getAuthenticatedClient();
            const blogger = google.blogger({ version: 'v3', auth });
            const blogId = vscode.workspace.getConfiguration('blogger').get<string>('selectedBlogId');

            if (!blogId) {
                throw new Error('No blog selected. Please select a blog first.');
            }

            Logger.debug(`Blogger API: pages.revert, blogId=${blogId}, pageId=${pageId}`);
            const response = await blogger.pages.revert({ blogId, pageId });
            return {
                pageId: response.data.id || pageId,
                url: response.data.url || null
            };
        } catch (error) {
            throw new Error(`Failed to unpublish page: ${error}`);
        }
    }

    async deletePost(postId: string): Promise<void> {
        try {
            const auth = await this.authManager.getAuthenticatedClient();
            const blogger = google.blogger({ version: 'v3', auth });

            const config = vscode.workspace.getConfiguration('blogger');
            const blogId = config.get<string>('selectedBlogId');

            if (!blogId) {
                throw new Error('No blog selected. Please select a blog first.');
            }

            Logger.debug(`Blogger API: posts.delete, blogId=${blogId}, postId=${postId}`);
            await blogger.posts.delete({
                blogId,
                postId
            });
        } catch (error) {
            throw new Error(`Failed to delete post: ${error}`);
        }
    }

    async deletePage(pageId: string): Promise<void> {
        try {
            const auth = await this.authManager.getAuthenticatedClient();
            const blogger = google.blogger({ version: 'v3', auth });
            const blogId = vscode.workspace.getConfiguration('blogger').get<string>('selectedBlogId');

            if (!blogId) {
                throw new Error('No blog selected. Please select a blog first.');
            }

            Logger.debug(`Blogger API: pages.delete, blogId=${blogId}, pageId=${pageId}`);
            await blogger.pages.delete({ blogId, pageId });
        } catch (error) {
            throw new Error(`Failed to delete page: ${error}`);
        }
    }

    async getExistingLabels(blogId?: string): Promise<string[]> {
        try {
            const auth = await this.authManager.getAuthenticatedClient();
            const blogger = google.blogger({ version: 'v3', auth });

            const config = vscode.workspace.getConfiguration('blogger');
            const selectedBlogId = blogId || config.get<string>('selectedBlogId');

            if (!selectedBlogId) {
                throw new Error('No blog selected. Please select a blog first.');
            }

            // Get all posts (including drafts) to collect labels
            Logger.debug(`Blogger API: posts.list (live labels), blogId=${selectedBlogId}`);
            Logger.debug(`Blogger API: posts.list (draft labels), blogId=${selectedBlogId}`);
            const [publishedResponse, draftResponse] = await Promise.all([
                blogger.posts.list({
                    blogId: selectedBlogId,
                    maxResults: this.getMaxResults(),
                    status: ['live']
                }),
                blogger.posts.list({
                    blogId: selectedBlogId,
                    maxResults: this.getMaxResults(),
                    status: ['draft']
                })
            ]);

            const allPosts = [
                ...(publishedResponse.data.items || []),
                ...(draftResponse.data.items || [])
            ];

            // Extract all unique labels
            const labelsSet = new Set<string>();
            allPosts.forEach(post => {
                if (post.labels) {
                    post.labels.forEach(label => labelsSet.add(label));
                }
            });

            // Convert to sorted array
            return Array.from(labelsSet).sort();
        } catch (error) {
            console.error('Failed to fetch existing labels:', error);
            return []; // Return empty array instead of throwing to avoid breaking the UI
        }
    }

    private getMaxResults(): number {
        const maxResults = vscode.workspace.getConfiguration('blogger').get<number>('maxResults', 50);
        if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 500) {
            throw new Error('Blogger: Max Results must be an integer between 1 and 500.');
        }
        return maxResults;
    }

    async uploadImage(imagePath: string): Promise<ImageUploadResult> {
        try {
            const auth = await this.authManager.getAuthenticatedClient();
            const drive = google.drive({ version: 'v3', auth });

            // Check if file exists and is an image
            if (!fs.existsSync(imagePath)) {
                throw new Error(`Image file not found: ${imagePath}`);
            }

            const fileName = path.basename(imagePath);
            const fileExtension = path.extname(fileName).toLowerCase();
            const supportedFormats = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];

            if (!supportedFormats.includes(fileExtension)) {
                throw new Error(`Unsupported image format: ${fileExtension}. Supported formats: ${supportedFormats.join(', ')}`);
            }

            const mimeType = this.getMimeType(fileExtension);

            // Create a unique filename to avoid conflicts
            const timestamp = Date.now();
            const uniqueFileName = `${path.parse(fileName).name}_${timestamp}${fileExtension}`;

            // Get or create the target folder
            const folderId = await this.getOrCreateFolder(drive);

            // Upload file to Google Drive
            const fileMetadata = {
                name: uniqueFileName,
                description: `Uploaded from VS Code Blogger Extension on ${new Date().toISOString()}`,
                parents: folderId ? [folderId] : undefined
            };

            const media = {
                mimeType: mimeType,
                body: fs.createReadStream(imagePath)
            };

            Logger.debug(`Google Drive API: files.create (image upload), name=${uniqueFileName}`);
            const driveResponse = await drive.files.create({
                requestBody: fileMetadata,
                media: media,
                fields: 'id, name, webViewLink, webContentLink'
            });

            const fileId = driveResponse.data.id!;

            // Make the file publicly accessible with view permissions
            Logger.debug(`Google Drive API: permissions.create, fileId=${fileId}`);
            await drive.permissions.create({
                fileId: fileId,
                requestBody: {
                    role: 'reader',
                    type: 'anyone'
                }
            });

            // Get the public download URL
            const publicUrl = `https://lh3.googleusercontent.com/d/${fileId}=s1024?authuser=0`;

            return {
                originalPath: imagePath,
                driveUrl: publicUrl,
                fileName: uniqueFileName,
                fileId: fileId
            };

        } catch (error) {
            throw new Error(`Failed to upload image to Google Drive: ${error}`);
        }
    }

    private async getOrCreateFolder(drive: any): Promise<string | null> {
        try {
            const config = vscode.workspace.getConfiguration('blogger');
            const customFolderPath = config.get<string>('googleDriveImageFolder');

            if (!customFolderPath || customFolderPath.trim() === '') {
                return null; // Use root folder
            }

            const folderNames = customFolderPath.split('/').map(name => name.trim()).filter(name => name);
            let currentParentId: string | null = null;

            for (const folderName of folderNames) {
                const existingFolder: any = await this.findFolder(drive, folderName, currentParentId);

                if (existingFolder) {
                    currentParentId = existingFolder.id;
                } else {
                    // Create the folder
                    const folderMetadata: any = {
                        name: folderName,
                        mimeType: 'application/vnd.google-apps.folder',
                        parents: currentParentId ? [currentParentId] : undefined
                    };

                    Logger.debug(`Google Drive API: files.create (folder), name=${folderName}`);
                    const folderResponse: any = await drive.files.create({
                        requestBody: folderMetadata,
                        fields: 'id'
                    });

                    currentParentId = folderResponse.data.id;
                }
            }

            return currentParentId;
        } catch (error) {
            console.error('Error creating/finding folder:', error);
            // Fall back to root folder if there's an error
            return null;
        }
    }

    private async findFolder(drive: any, folderName: string, parentId: string | null): Promise<any> {
        try {
            const query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
            const parentQuery = parentId ? ` and '${parentId}' in parents` : " and 'root' in parents";
            
            Logger.debug(`Google Drive API: files.list (find folder), name=${folderName}`);
            const response = await drive.files.list({
                q: query + parentQuery,
                fields: 'files(id, name)',
                pageSize: 1
            });

            return response.data.files && response.data.files.length > 0 ? response.data.files[0] : null;
        } catch (error) {
            console.error('Error finding folder:', error);
            return null;
        }
    }

    private getMimeType(extension: string): string {
        const mimeTypes: { [key: string]: string } = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.bmp': 'image/bmp',
            '.webp': 'image/webp'
        };
        return mimeTypes[extension.toLowerCase()] || 'image/jpeg';
    }

    async uploadMultipleImages(imagePaths: string[]): Promise<ImageUploadResult[]> {
        const results: ImageUploadResult[] = [];
        
        for (const imagePath of imagePaths) {
            try {
                const result = await this.uploadImage(imagePath);
                results.push(result);
            } catch (error) {
                console.error(`Failed to upload image ${imagePath}:`, error);
                // Continue with other images even if one fails
            }
        }
        
        return results;
    }
}