import * as vscode from 'vscode';
import { BloggerService, isNotFoundError } from './bloggerService';
import { AuthManager } from './authManager';
import { BloggerPostsProvider } from './postsProvider';
import { BloggerPagesProvider } from './pagesProvider';
import { BloggerItemType, BloggerTreeItem } from './blogItem';
import {
    deleteLocalDraftMetadata,
    getLocalDraftMetadataUri,
    readLocalDraftMetadata,
    writeLocalDraftMetadata
} from './localDraftMetadata';
import { BloggerBlogsProvider } from './blogsProvider';
import { BloggerInfoProvider } from './infoProvider';
import { Logger, Utils } from './utils';

let bloggerService: BloggerService;
let authManager: AuthManager;
let postsProvider: BloggerPostsProvider;
let pagesProvider: BloggerPagesProvider;
let blogsProvider: BloggerBlogsProvider;
let pagesDraftsUri: vscode.Uri | undefined;
let pagesPublishedUri: vscode.Uri | undefined;
let postsDraftsUri: vscode.Uri | undefined;
let postsPublishedUri: vscode.Uri | undefined;
let pagesTemplatesUri: vscode.Uri | undefined;
let postsTemplatesUri: vscode.Uri | undefined;

export async function activate(context: vscode.ExtensionContext) {
    console.log('Blogger Publisher extension is now active!');

    /* Initialize services */
    authManager = new AuthManager(context);
    bloggerService = new BloggerService(authManager);

    /* Init workspace */
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const setLocalDirectoriesForBlog = async (blogId?: string) => {
        if (workspaceFolder && blogId) {
            const blogUri = vscode.Uri.joinPath(workspaceFolder.uri, '.blogger', 'blogs', blogId);
            const nextPagesDraftsUri = vscode.Uri.joinPath(blogUri, 'pages', 'drafts');
            const nextPagesPublishedUri = vscode.Uri.joinPath(blogUri, 'pages', 'published');
            const nextPostsDraftsUri = vscode.Uri.joinPath(blogUri, 'posts', 'drafts');
            const nextPostsPublishedUri = vscode.Uri.joinPath(blogUri, 'posts', 'published');
            const nextPostsTemplatesUri = vscode.Uri.joinPath(blogUri, 'posts', 'templates');
            const nextPagesTemplatesUri = vscode.Uri.joinPath(blogUri, 'pages', 'templates');
            await Promise.all([
                vscode.workspace.fs.createDirectory(nextPagesDraftsUri),
                vscode.workspace.fs.createDirectory(nextPagesPublishedUri),
                vscode.workspace.fs.createDirectory(nextPostsDraftsUri),
                vscode.workspace.fs.createDirectory(nextPostsPublishedUri),
                vscode.workspace.fs.createDirectory(nextPostsTemplatesUri),
                vscode.workspace.fs.createDirectory(nextPagesTemplatesUri)
            ]);

            const migrateLegacyCopies = async (
                kind: 'post' | 'page',
                status: 'drafts' | 'published',
                targetDirectory: vscode.Uri
            ) => {
                const legacyDirectory = vscode.Uri.joinPath(
                    workspaceFolder.uri,
                    '.blogger',
                    kind === 'post' ? 'posts' : 'pages',
                    status
                );
                let entries: [string, vscode.FileType][];
                try {
                    entries = await vscode.workspace.fs.readDirectory(legacyDirectory);
                } catch (error) {
                    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                        return;
                    }
                    throw error;
                }

                for (const [name, type] of entries) {
                    if (type !== vscode.FileType.File || !/\.html$/i.test(name)) {
                        continue;
                    }

                    const sourceUri = vscode.Uri.joinPath(legacyDirectory, name);
                    const metadata = await readLocalDraftMetadata(sourceUri);
                    if (!metadata || metadata.blogId !== blogId || metadata.kind !== kind) {
                        continue;
                    }

                    const targetUri = vscode.Uri.joinPath(targetDirectory, name);
                    const targetMetadataUri = getLocalDraftMetadataUri(targetUri);
                    if (await Utils.fileExists(targetUri) || await Utils.fileExists(targetMetadataUri)) {
                        continue;
                    }

                    const sourceMetadataUri = getLocalDraftMetadataUri(sourceUri);
                    await vscode.workspace.fs.rename(sourceUri, targetUri);
                    try {
                        await vscode.workspace.fs.rename(sourceMetadataUri, targetMetadataUri);
                    } catch (error) {
                        await vscode.workspace.fs.rename(targetUri, sourceUri);
                        throw error;
                    }
                }
            };

            await Promise.all([
                migrateLegacyCopies('post', 'drafts', nextPostsDraftsUri),
                migrateLegacyCopies('post', 'published', nextPostsPublishedUri),
                migrateLegacyCopies('page', 'drafts', nextPagesDraftsUri),
                migrateLegacyCopies('page', 'published', nextPagesPublishedUri)
            ]);

            pagesDraftsUri = nextPagesDraftsUri;
            pagesPublishedUri = nextPagesPublishedUri;
            postsDraftsUri = nextPostsDraftsUri;
            postsPublishedUri = nextPostsPublishedUri;
            pagesTemplatesUri = nextPagesTemplatesUri;
            postsTemplatesUri = nextPostsTemplatesUri;
        } else {
            pagesDraftsUri = undefined;
            pagesPublishedUri = undefined;
            postsDraftsUri = undefined;
            postsPublishedUri = undefined;
            pagesTemplatesUri = undefined;
            postsTemplatesUri = undefined;
        }

        postsProvider?.setLocalDirectories(postsDraftsUri, postsPublishedUri);
        pagesProvider?.setLocalDirectories(pagesDraftsUri, pagesPublishedUri);
    };

    if (workspaceFolder) {
        const selectedBlogId = vscode.workspace.getConfiguration('blogger').get<string>('selectedBlogId');
        await setLocalDirectoriesForBlog(selectedBlogId);
    } else {
        vscode.window.showWarningMessage(`No workspace exists.`);
    }

    postsProvider = new BloggerPostsProvider(bloggerService, postsDraftsUri, postsPublishedUri);
    const refreshPostsCommand = vscode.commands.registerCommand('bloggerPosts.refresh', () => {
        postsProvider.refresh();
    });

    pagesProvider = new BloggerPagesProvider(bloggerService, pagesDraftsUri, pagesPublishedUri);
    const refreshPagesCommand = vscode.commands.registerCommand('bloggerPages.refresh', () => {
        pagesProvider.refresh();
    });

    blogsProvider = new BloggerBlogsProvider(bloggerService);
    const refreshBlogsCommand = vscode.commands.registerCommand('bloggerBlogs.refresh', () => {
        blogsProvider.refresh();
    });

    const createLocalDraft = async (
        title: string,
        draftsUri: vscode.Uri,
        templatesUri: vscode.Uri
    ): Promise<vscode.Uri | undefined> => {
        const entries = await vscode.workspace.fs.readDirectory(templatesUri);
        const templates = entries
            .filter(([name, type]) => type === vscode.FileType.File && /\.html?$/i.test(name))
            .map(([name]) => ({
                label: name.replace(/\.html?$/i, ''),
                description: name,
                uri: vscode.Uri.joinPath(templatesUri, name)
            }));

        let selectedTemplate: vscode.Uri | undefined;
        if (templates.length > 0) {
            const blankOption = { label: 'Start with a blank file', description: 'No template', uri: undefined };
            const selected = await vscode.window.showQuickPick(
                [blankOption, ...templates],
                { placeHolder: 'Select a template for the new file' }
            );
            if (!selected) {
                return undefined;
            }
            selectedTemplate = selected.uri;
        }

        const fileName = `${title.replace(/[\\/:*?"<>|]/g, '-').trim()}.html`;
        const draftUri = vscode.Uri.joinPath(draftsUri, fileName);
        if (!(await Utils.fileExists(draftUri))) {
            const content = selectedTemplate
                ? await vscode.workspace.fs.readFile(selectedTemplate)
                : new Uint8Array();
            await vscode.workspace.fs.writeFile(draftUri, content);
        }
        return draftUri;
    };

    const newPagesCommand = vscode.commands.registerCommand('bloggerPages.new', async () => {
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Open a workspace folder before creating a local page.');
            return;
        }
        if (!pagesDraftsUri || !pagesTemplatesUri) {
            vscode.window.showErrorMessage('Select a blog before creating a local page.');
            return;
        }
        const pageName = await vscode.window.showInputBox({
            prompt: 'Enter a name for the page',
            placeHolder: 'About Us'
        });
        if (!pageName) {
            return;
        }
        try {
            const uri = await createLocalDraft(pageName, pagesDraftsUri, pagesTemplatesUri);
            if (!uri) {
                return;
            }
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document);
            pagesProvider.refreshLocal();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create page: ${error}`);
        }
    });

    const newPostsCommand = vscode.commands.registerCommand('bloggerPosts.new', async () => {
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Open a workspace folder before creating a local post.');
            return;
        }
        if (!postsDraftsUri || !postsTemplatesUri) {
            vscode.window.showErrorMessage('Select a blog before creating a local post.');
            return;
        }
        const postName = await vscode.window.showInputBox({
            prompt: 'Enter a title for the post',
            placeHolder: 'My New Post'
        });
        if (!postName) {
            return;
        }
        try {
            const uri = await createLocalDraft(postName, postsDraftsUri, postsTemplatesUri);
            if (!uri) {
                return;
            }
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document);
            postsProvider.refreshLocal();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create post: ${error}`);
        }
    });

    const localDraftWatchers: vscode.Disposable[] = [];
    if (workspaceFolder) {
        const localFilesWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspaceFolder, '.blogger/blogs/**/*.html')
        );
        const refreshLocalPosts = () => postsProvider.refreshLocal();
        const refreshLocalPages = () => pagesProvider.refreshLocal();

        localDraftWatchers.push(
            localFilesWatcher,
            localFilesWatcher.onDidCreate(uri => {
                if (uri.path.includes('/posts/')) {
                    refreshLocalPosts();
                } else if (uri.path.includes('/pages/')) {
                    refreshLocalPages();
                }
            }),
            localFilesWatcher.onDidChange(uri => {
                if (uri.path.includes('/posts/')) {
                    refreshLocalPosts();
                } else if (uri.path.includes('/pages/')) {
                    refreshLocalPages();
                }
            }),
            localFilesWatcher.onDidDelete(uri => {
                if (uri.path.includes('/posts/')) {
                    refreshLocalPosts();
                } else if (uri.path.includes('/pages/')) {
                    refreshLocalPages();
                }
            })
        );
    }

    const bloggerInfoProvider = new BloggerInfoProvider();
    const bloggerInfoTreeView = vscode.window.createTreeView('blogger.info', {
        treeDataProvider: bloggerInfoProvider
    });
    const postsTreeView = vscode.window.createTreeView('blogger.posts', {
        treeDataProvider: postsProvider
    });
    const pagesTreeView = vscode.window.createTreeView('blogger.pages', {
        treeDataProvider: pagesProvider
    });
    const blogsTreeView = vscode.window.createTreeView('blogger.blogs', {
        treeDataProvider: blogsProvider
    });
    let infoRequestGeneration = 0;
    const updateInfo = async (item: BloggerTreeItem | undefined) => {
        const requestGeneration = ++infoRequestGeneration;
        if (!item) {
            bloggerInfoProvider.clear();
            return;
        }

        const isBlog = item.contextValue === 'bloggerBlog';
        const isPostOrPage = item.Type === BloggerItemType.Post || item.Type === BloggerItemType.Page;
        if (!isBlog && !isPostOrPage) {
            bloggerInfoProvider.clear();
            return;
        }

        try {
            const isLocal = Boolean(item.LocalFilePath);
            let fields: Array<{ label: string; value: string }>;
            if (isBlog) {
                if (!item.id) {
                    throw new Error('The Blogger blog ID is missing.');
                }
                const data = await bloggerService.getBlog(item.id);
                fields = [
                    { label: 'Type', value: 'Blog' },
                    { label: 'ID', value: data.id || item.id },
                    { label: 'Name', value: data.name || String(item.label || 'Untitled') },
                    { label: 'Description', value: data.description || '' },
                    { label: 'URL', value: data.url || item.Url || '' },
                    { label: 'Published', value: data.published || '' },
                    { label: 'Updated', value: data.updated || '' },
                    { label: 'Posts', value: data.posts?.totalItems?.toString() || '' },
                    { label: 'Pages', value: data.pages?.totalItems?.toString() || '' },
                    {
                        label: 'Language',
                        value: [data.locale?.language, data.locale?.country].filter(Boolean).join('-')
                    }
                ].filter(field => field.value.length > 0);
            } else if (isLocal && item.LocalFilePath) {
                const metadata = await readLocalDraftMetadata(vscode.Uri.file(item.LocalFilePath));
                const expectedKind = item.Type === BloggerItemType.Post ? 'post' : 'page';
                if (!metadata) {
                    if (requestGeneration === infoRequestGeneration) {
                        bloggerInfoProvider.clear();
                        vscode.window.showInformationMessage(
                            `Save this ${expectedKind} to Blogger before its information can be loaded.`
                        );
                    }
                    return;
                }
                if (metadata.kind !== expectedKind) {
                    throw new Error('This local file does not have valid Blogger metadata.');
                }

                fields = [
                    { label: 'Type', value: item.Type === BloggerItemType.Post ? 'Post' : 'Page' },
                    { label: 'ID', value: metadata.bloggerId },
                    { label: 'Blog ID', value: metadata.blogId },
                    { label: 'Title', value: String(item.label || 'Untitled') },
                    {
                        label: 'Status',
                        value: metadata.status || (item.contextValue?.endsWith('_localPublished') ? 'LIVE' : 'DRAFT')
                    },
                    { label: 'Local file', value: item.LocalFilePath }
                ];
            } else {
                if (!item.id) {
                    throw new Error('The Blogger item ID is missing.');
                }

                const data = item.Type === BloggerItemType.Post
                    ? await bloggerService.getPost(undefined, item.id)
                    : await bloggerService.getPage(undefined, item.id);
                if (!data) {
                    throw new Error('Blogger returned no item details.');
                }

                fields = [
                    { label: 'Type', value: item.Type === BloggerItemType.Post ? 'Post' : 'Page' },
                    { label: 'ID', value: data.id || item.id },
                    { label: 'Title', value: data.title || String(item.label || 'Untitled') },
                    { label: 'Status', value: data.status || 'Unknown' },
                    { label: 'URL', value: data.url || item.Url || '' },
                    { label: 'Published', value: data.published || '' },
                    { label: 'Updated', value: data.updated || '' },
                    { label: 'Author', value: data.author?.displayName || '' },
                    { label: 'Labels', value: Array.isArray(data.labels) ? data.labels.join(', ') : '' }
                ].filter(field => field.value.length > 0);
            }

            if (requestGeneration !== infoRequestGeneration) {
                return;
            }
            const firstInfoItem = bloggerInfoProvider.show(fields);
            if (firstInfoItem) {
                await bloggerInfoTreeView.reveal(firstInfoItem, { focus: false });
            }
        } catch (error) {
            if (requestGeneration === infoRequestGeneration) {
                bloggerInfoProvider.clear();
                vscode.window.showErrorMessage(`Failed to load info for "${item.label}": ${error}`);
            }
        }
    };
    const selectedBlogChangeListener = vscode.workspace.onDidChangeConfiguration(async event => {
        if (event.affectsConfiguration('blogger.selectedBlogId')) {
            const selectedBlogId = vscode.workspace.getConfiguration('blogger').get<string>('selectedBlogId');
            infoRequestGeneration++;
            try {
                await setLocalDirectoriesForBlog(selectedBlogId);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to initialize local files for the selected blog: ${error}`);
            }
            pagesProvider.refresh();
            postsProvider.refresh();
            blogsProvider.refresh();
            if (selectedBlogId) {
                const selectedBlogItem = new BloggerTreeItem(selectedBlogId);
                selectedBlogItem.id = selectedBlogId;
                selectedBlogItem.contextValue = 'bloggerBlog';
                await updateInfo(selectedBlogItem);
            } else {
                bloggerInfoProvider.clear();
            }
        }
    });
    const infoSelectionListeners = [
        blogsTreeView.onDidChangeSelection(event => updateInfo(event.selection[0])),
        postsTreeView.onDidChangeSelection(event => updateInfo(event.selection[0])),
        pagesTreeView.onDidChangeSelection(event => updateInfo(event.selection[0]))
    ];

    /* Register commands */
    const authenticateCommand = vscode.commands.registerCommand('blogger.authenticate', async () => {
        try {
            await authManager.authenticate();
            vscode.window.showInformationMessage('Successfully authenticated with Blogger!');
        } catch (error) {
            vscode.window.showErrorMessage(`Authentication failed: ${error}`);
        }
    });

    const getDriveFoldersCommand = vscode.commands.registerCommand('blogger.getDriveFolders', async () => {
        try {
            if (!await authManager.isAuthenticated()) {
                vscode.window.showWarningMessage('Authenticate with Blogger before listing Google Drive folders.');
                return;
            }

            const folders = await bloggerService.getFolders();
            if (folders.length === 0) {
                vscode.window.showInformationMessage(
                    'No Google Drive folders found. If your Drive has folders, run "Blogger: Authenticate with Blogger" again and grant the Google Drive metadata permission.'
                );
                return;
            }

            await vscode.window.showQuickPick(
                folders.map(folder => ({
                    label: folder.name,
                    description: folder.id
                })),
                {
                    placeHolder: 'Google Drive folders (type to filter)',
                    matchOnDescription: true
                }
            );
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load Google Drive folders: ${error}`);
        }
    });

    const listFolderContentCommand = vscode.commands.registerCommand('blogger.listFolderContent', async () => {
        try {
            if (!await authManager.isAuthenticated()) {
                vscode.window.showWarningMessage('Authenticate with Blogger before listing Google Drive folder contents.');
                return;
            }

            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('Open a file and place the cursor where you want to insert the Google Drive URL.');
                return;
            }
            const cursorPosition = editor.selection.active;

            const folderPath = vscode.workspace.getConfiguration('blogger')
                .get<string>('googleDriveImageFolder', '').trim();
            if (!folderPath) {
                vscode.window.showInformationMessage(
                    'Set Blogger: Google Drive Image Folder in Settings to the folder name or path whose contents you want to list.'
                );
                return;
            }

            const contents = await bloggerService.getFolderContent(folderPath);
            if (!contents) {
                vscode.window.showInformationMessage(
                    `Google Drive folder "${folderPath}" was not found. Check Blogger: Google Drive Image Folder in Settings.`
                );
                return;
            }
            if (contents.length === 0) {
                vscode.window.showInformationMessage(`Google Drive folder "${folderPath}" is empty.`);
                return;
            }

            const selectedFile = await vscode.window.showQuickPick(
                contents.map(file => {
                    const isImage = file.mimeType.startsWith('image/');
                    const url = isImage
                        ? `https://lh3.googleusercontent.com/d/${encodeURIComponent(file.id)}=s1024?authuser=0`
                        : file.webViewLink || `https://drive.google.com/open?id=${encodeURIComponent(file.id)}`;
                    return {
                        label: file.name,
                        description: file.mimeType === 'application/vnd.google-apps.folder' ? 'Folder' : 'File',
                        detail: isImage ? 'Image URL' : file.id,
                        url
                    };
                }),
                {
                    placeHolder: `Contents of Google Drive folder "${folderPath}"`,
                    matchOnDescription: true,
                    matchOnDetail: true
                }
            );
            if (!selectedFile) {
                return;
            }

            const inserted = await editor.edit(editBuilder => {
                editBuilder.insert(cursorPosition, selectedFile.url);
            });
            if (!inserted) {
                vscode.window.showErrorMessage('Could not insert the Google Drive URL into the current file.');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to list Google Drive folder contents: ${error}`);
        }
    });

    const modifyPageCommand = vscode.commands.registerCommand(
        'bloggerItem.modifyPage',
        async (item: BloggerTreeItem) => {
            if (item.LocalFilePath) {
                const document = await vscode.workspace.openTextDocument(vscode.Uri.file(item.LocalFilePath));
                await vscode.window.showTextDocument(document);
                return;
            }

            if (!item.id) {
                return;
            }
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('Open a workspace folder before creating a local page copy.');
                return;
            }
            const data = await bloggerService.getPage(undefined, item.id);
            if (!data) {
                Logger.warn("No content");
                return;
            }

            const fileName = `${data.title || 'Untitled'}.html`
                .replace(/[\\/:*?"<>|]/g, '-');
            if (!pagesDraftsUri || !pagesPublishedUri) {
                throw new Error('Select a blog before creating a local page copy.');
            }
            const targetDirectory = item.contextValue === 'bloggerPage_published'
                ? pagesPublishedUri
                : pagesDraftsUri;
            const uri = vscode.Uri.joinPath(targetDirectory, fileName);
            if (await Utils.fileExists(uri)) {
                const confirmation = await vscode.window.showWarningMessage(
                    `The local copy of "${item.label}" already exists. Replace its content? The current content will be lost.`,
                    { modal: true }, 'Yes', 'No');
                if (confirmation !== 'Yes') {
                    return;
                }
            }
            await vscode.workspace.fs.writeFile(uri, Buffer.from(data.content || '', 'utf8'));
            const blogId = vscode.workspace.getConfiguration('blogger').get<string>('selectedBlogId');
            if (!blogId) {
                throw new Error('No blog selected. Please select a blog first.');
            }
            await writeLocalDraftMetadata(uri, {
                kind: 'page',
                bloggerId: item.id,
                blogId,
                status: item.contextValue === 'bloggerPage_published' ? 'LIVE' : 'DRAFT'
            });
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document);
            pagesProvider.refreshLocal();
        }
    );

    const modifyPostCommand = vscode.commands.registerCommand(
        'bloggerItem.modifyPost',
        async (item: BloggerTreeItem) => {
            if (item.LocalFilePath) {
                const document = await vscode.workspace.openTextDocument(vscode.Uri.file(item.LocalFilePath));
                await vscode.window.showTextDocument(document);
                return;
            }

            if (!item.id) {
                return;
            }
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('Open a workspace folder before creating a local post copy.');
                return;
            }
            const data = await bloggerService.getPost(undefined, item.id);
            if (!data) {
                Logger.warn("No content");
                return;
            }

            const fileName = `${data.title || 'Untitled'}.html`
                .replace(/[\\/:*?"<>|]/g, '-');
            if (!postsDraftsUri || !postsPublishedUri) {
                throw new Error('Select a blog before creating a local post copy.');
            }
            const targetDirectory = item.contextValue === 'bloggerPost_published'
                ? postsPublishedUri
                : postsDraftsUri;
            const uri = vscode.Uri.joinPath(targetDirectory, fileName);
            if (await Utils.fileExists(uri)) {
                if (await Utils.fileExists(uri)) {
                const confirmation = await vscode.window.showWarningMessage(
                    `The local copy of "${item.label}" already exists. Replace its content? The current content will be lost.`,
                    { modal: true }, 'Yes', 'No');
                if (confirmation !== 'Yes') {
                    return;
                }
            }
            }
            await vscode.workspace.fs.writeFile(uri, Buffer.from(data.content || '', 'utf8'));
            const blogId = vscode.workspace.getConfiguration('blogger').get<string>('selectedBlogId');
            if (!blogId) {
                throw new Error('No blog selected. Please select a blog first.');
            }
            await writeLocalDraftMetadata(uri, {
                kind: 'post',
                bloggerId: item.id,
                blogId,
                status: item.contextValue === 'bloggerPost_published' ? 'LIVE' : 'DRAFT'
            });
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document);
            postsProvider.refreshLocal();
        }
    );

    const saveDraftCommand = vscode.commands.registerCommand(
        'bloggerItem.saveDraft',
        async (item: BloggerTreeItem | undefined) => {
            if (!item?.LocalFilePath) {
                vscode.window.showErrorMessage('Only a local draft can be saved to Blogger.');
                return;
            }

            try {
                const content = Buffer.from(
                    await vscode.workspace.fs.readFile(vscode.Uri.file(item.LocalFilePath))
                ).toString('utf8');
                const title = String(item.label || 'Untitled');
                const fileUri = vscode.Uri.file(item.LocalFilePath);
                const selectedBlogId = vscode.workspace.getConfiguration('blogger').get<string>('selectedBlogId');
                if (!selectedBlogId) {
                    throw new Error('No blog selected. Please select a blog first.');
                }
                let existingMetadata = await readLocalDraftMetadata(fileUri);
                if (existingMetadata && existingMetadata.blogId !== selectedBlogId) {
                    throw new Error('This local copy belongs to a different Blogger blog.');
                }
                const expectedKind = item.Type === BloggerItemType.Post ? 'post' : 'page';
                if (existingMetadata && existingMetadata.kind !== expectedKind) {
                    throw new Error('This local copy is linked to a different Blogger item type.');
                }
                const isPublishedLocal = item.contextValue === 'bloggerPost_localPublished'
                    || item.contextValue === 'bloggerPage_localPublished';
                if (existingMetadata && !existingMetadata.status) {
                    existingMetadata = {
                        ...existingMetadata,
                        status: isPublishedLocal ? 'LIVE' : 'DRAFT'
                    };
                }

                if (item.Type === BloggerItemType.Post) {
                    if (!existingMetadata) {
                        const matchingDrafts = (await bloggerService.getPosts())
                            .filter(post => post.title === title
                                && post.status?.toUpperCase() === (isPublishedLocal ? 'LIVE' : 'DRAFT'));
                        if (isPublishedLocal && matchingDrafts.length === 0) {
                            throw new Error('Could not find the published Blogger post linked to this local copy.');
                        }
                        if (matchingDrafts.length > 0) {
                            const selectedDraft = await vscode.window.showQuickPick([
                                ...matchingDrafts.map(post => ({
                                    label: post.title || title,
                                    description: `Existing Blogger ${isPublishedLocal ? 'published post' : 'draft'} (${post.id})`,
                                    id: post.id
                                })),
                                ...(!isPublishedLocal ? [{
                                    label: 'Create a new Blogger draft',
                                    description: 'Save this local file as a separate draft',
                                    id: undefined
                                }] : [])
                            ], { placeHolder: 'Update the matching Blogger draft or create a separate one' });
                            if (!selectedDraft) {
                                return;
                            }
                            if (selectedDraft.id) {
                                existingMetadata = {
                                    kind: 'post',
                                    bloggerId: selectedDraft.id,
                                    blogId: selectedBlogId,
                                    status: isPublishedLocal ? 'LIVE' : 'DRAFT'
                                };
                            }
                        }
                    }

                    if (existingMetadata) {
                        let currentPost: any;
                        try {
                            currentPost = await bloggerService.getPost(
                                existingMetadata.blogId,
                                existingMetadata.bloggerId
                            );
                        } catch (error) {
                            if (!isNotFoundError(error)) {
                                throw error;
                            }
                        }
                        const status = existingMetadata.status || (isPublishedLocal ? 'LIVE' : 'DRAFT');
                        if (!currentPost) {
                            const result = await bloggerService.publishPost({
                                title,
                                content,
                                labels: [],
                                isDraft: status !== 'LIVE'
                            });
                            existingMetadata = { ...existingMetadata, bloggerId: result.postId, status };
                        } else {
                            const labels = Array.isArray(currentPost.labels) ? currentPost.labels : [];
                            if (status === 'LIVE') {
                                await bloggerService.updatePost(existingMetadata.bloggerId, {
                                    title,
                                    content,
                                    labels,
                                    isDraft: false
                                });
                            } else {
                                await bloggerService.updateDraftPost(
                                    existingMetadata.bloggerId,
                                    title,
                                    content,
                                    labels
                                );
                            }
                        }
                        await writeLocalDraftMetadata(fileUri, existingMetadata);
                    } else {
                        const result = await bloggerService.publishPost({
                            title,
                            content,
                            labels: [],
                            isDraft: true
                        });
                        await writeLocalDraftMetadata(fileUri, {
                            kind: 'post',
                            bloggerId: result.postId,
                            blogId: selectedBlogId,
                            status: 'DRAFT'
                        });
                    }
                    postsProvider.refresh();
                } else if (item.Type === BloggerItemType.Page) {
                    if (!existingMetadata) {
                        const matchingDrafts = (await bloggerService.getPages())
                            .filter(page => page.title === title
                                && page.status?.toUpperCase() === (isPublishedLocal ? 'LIVE' : 'DRAFT'));
                        if (isPublishedLocal && matchingDrafts.length === 0) {
                            throw new Error('Could not find the published Blogger page linked to this local copy.');
                        }
                        if (matchingDrafts.length > 0) {
                            const selectedDraft = await vscode.window.showQuickPick([
                                ...matchingDrafts.map(page => ({
                                    label: page.title || title,
                                    description: `Existing Blogger ${isPublishedLocal ? 'published page' : 'draft'} (${page.id})`,
                                    id: page.id
                                })),
                                ...(!isPublishedLocal ? [{
                                    label: 'Create a new Blogger draft',
                                    description: 'Save this local file as a separate draft',
                                    id: undefined
                                }] : [])
                            ], { placeHolder: 'Update the matching Blogger draft or create a separate one' });
                            if (!selectedDraft) {
                                return;
                            }
                            if (selectedDraft.id) {
                                existingMetadata = {
                                    kind: 'page',
                                    bloggerId: selectedDraft.id,
                                    blogId: selectedBlogId,
                                    status: isPublishedLocal ? 'LIVE' : 'DRAFT'
                                };
                            }
                        }
                    }

                    if (existingMetadata) {
                        const status = existingMetadata.status || (isPublishedLocal ? 'LIVE' : 'DRAFT');
                        let pageExists = true;
                        try {
                            await bloggerService.getPage(existingMetadata.blogId, existingMetadata.bloggerId);
                        } catch (error) {
                            if (!isNotFoundError(error)) {
                                throw error;
                            }
                            pageExists = false;
                            const result = await bloggerService.createPage(title, content, status !== 'LIVE');
                            existingMetadata = { ...existingMetadata, bloggerId: result.pageId, status };
                        }
                        if (pageExists) {
                            try {
                                await bloggerService.updatePage(existingMetadata.bloggerId, title, content);
                            } catch (error) {
                                if (!isNotFoundError(error)) {
                                    throw error;
                                }
                                const result = await bloggerService.createPage(title, content, status !== 'LIVE');
                                existingMetadata = { ...existingMetadata, bloggerId: result.pageId, status };
                            }
                        }
                        await writeLocalDraftMetadata(fileUri, existingMetadata);
                    } else {
                        const result = await bloggerService.createPage(title, content, true);
                        await writeLocalDraftMetadata(fileUri, {
                            kind: 'page',
                            bloggerId: result.pageId,
                            blogId: selectedBlogId,
                            status: 'DRAFT'
                        });
                    }
                    pagesProvider.refresh();
                } else {
                    vscode.window.showErrorMessage('This item is not a Blogger post or page.');
                    return;
                }

                vscode.window.showInformationMessage(
                    `"${title}" was saved to Blogger${isPublishedLocal ? '' : ' as a draft'}.`
                );
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to save "${item.label}" to Blogger: ${error}`);
            }
        }
    );

    const editPostLabelsCommand = vscode.commands.registerCommand(
        'bloggerItem.editPostLabels',
        async (item: BloggerTreeItem | undefined) => {
            if (!item || item.Type !== BloggerItemType.Post) {
                vscode.window.showErrorMessage('Select a Blogger post to edit its labels.');
                return;
            }

            try {
                const selectedBlogId = vscode.workspace.getConfiguration('blogger').get<string>('selectedBlogId');
                if (!selectedBlogId) {
                    throw new Error('No blog selected. Please select a blog first.');
                }

                let postId = item.id;
                let blogId = selectedBlogId;
                if (item.LocalFilePath) {
                    const metadata = await readLocalDraftMetadata(vscode.Uri.file(item.LocalFilePath));
                    if (!metadata || metadata.kind !== 'post') {
                        throw new Error('This local post is not linked to a Blogger post.');
                    }
                    if (metadata.blogId !== selectedBlogId) {
                        throw new Error('This local copy belongs to a different Blogger blog.');
                    }
                    postId = metadata.bloggerId;
                    blogId = metadata.blogId;
                }

                if (!postId) {
                    throw new Error('The Blogger post ID is missing.');
                }

                const post = await bloggerService.getPost(blogId, postId);
                const currentLabels = Array.isArray(post.labels) ? post.labels.join(', ') : '';
                const availableLabels = await bloggerService.getExistingLabels(blogId);
                const labelSuggestions = availableLabels.length > 0
                    ? `Existing labels: ${availableLabels.slice(0, 8).join(', ')}${availableLabels.length > 8 ? ', …' : ''}`
                    : 'news, updates';
                const input = await vscode.window.showInputBox({
                    prompt: 'Enter labels separated by commas. Leave empty to remove all labels.',
                    value: currentLabels,
                    placeHolder: labelSuggestions
                });
                if (input === undefined) {
                    return;
                }

                const labels = [...new Set(input.split(',').map(label => label.trim()).filter(Boolean))];
                await bloggerService.updatePostLabels(blogId, postId, labels);
                postsProvider.refresh();
                await updateInfo(item);
                vscode.window.showInformationMessage(
                    labels.length > 0 ? 'Post labels updated.' : 'All post labels removed.'
                );
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to edit post labels: ${error}`);
            }
        }
    );

    const publishItemCommand = vscode.commands.registerCommand(
        'bloggerItem.publish',
        async (item: BloggerTreeItem | undefined) => {
            if (!item || (!item.id && !item.LocalFilePath)) {
                vscode.window.showErrorMessage('Could not publish this item because its Blogger ID or local draft file is missing.');
                return;
            }

            try {
                if (item.Type === BloggerItemType.Post) {
                    if (item.LocalFilePath) {
                        const fileUri = vscode.Uri.file(item.LocalFilePath);
                        const content = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf8');
                        const blogId = vscode.workspace.getConfiguration('blogger').get<string>('selectedBlogId');
                        if (!blogId) {
                            throw new Error('No blog selected. Please select a blog first.');
                        }
                        let metadata = await readLocalDraftMetadata(fileUri);
                        if (metadata && (metadata.kind !== 'post' || metadata.blogId !== blogId)) {
                            throw new Error('This local copy is linked to a different Blogger item or blog.');
                        }

                        let postId = metadata?.bloggerId;
                        if (postId) {
                            try {
                                const result = await bloggerService.publishDraftPost(postId);
                                postId = result.postId;
                            } catch (error) {
                                if (!isNotFoundError(error)) {
                                    throw error;
                                }
                                postId = undefined;
                            }
                        }
                        if (!postId) {
                            const result = await bloggerService.publishPost({
                                title: String(item.label || 'Untitled Post'),
                                content,
                                labels: [],
                                isDraft: false
                            });
                            postId = result.postId;
                        }
                        await writeLocalDraftMetadata(fileUri, {
                            kind: 'post',
                            bloggerId: postId,
                            blogId,
                            status: 'LIVE'
                        });
                    } else if (item.id) {
                        await bloggerService.publishDraftPost(item.id);
                    } else {
                        throw new Error('The local draft file could not be found.');
                    }
                    postsProvider.refresh();
                } else if (item.Type === BloggerItemType.Page) {
                    if (item.LocalFilePath) {
                        const fileUri = vscode.Uri.file(item.LocalFilePath);
                        const content = Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf8');
                        const blogId = vscode.workspace.getConfiguration('blogger').get<string>('selectedBlogId');
                        if (!blogId) {
                            throw new Error('No blog selected. Please select a blog first.');
                        }
                        let metadata = await readLocalDraftMetadata(fileUri);
                        if (metadata && (metadata.kind !== 'page' || metadata.blogId !== blogId)) {
                            throw new Error('This local copy is linked to a different Blogger item or blog.');
                        }

                        let pageId = metadata?.bloggerId;
                        if (pageId) {
                            try {
                                const result = await bloggerService.publishDraftPage(pageId);
                                pageId = result.pageId;
                            } catch (error) {
                                if (!isNotFoundError(error)) {
                                    throw error;
                                }
                                pageId = undefined;
                            }
                        }
                        if (!pageId) {
                            const result = await bloggerService.createPage(
                                String(item.label || 'Untitled Page'),
                                content,
                                false
                            );
                            pageId = result.pageId;
                        }
                        await writeLocalDraftMetadata(fileUri, {
                            kind: 'page',
                            bloggerId: pageId,
                            blogId,
                            status: 'LIVE'
                        });
                    } else if (item.id) {
                        await bloggerService.publishDraftPage(item.id);
                    } else {
                        throw new Error('The local draft file could not be found.');
                    }
                    pagesProvider.refresh();
                } else {
                    vscode.window.showErrorMessage('This item is not a Blogger post or page.');
                    return;
                }

                vscode.window.showInformationMessage(`"${item.label}" was published successfully.`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to publish "${item.label}": ${error}`);
            }
        }
    );

    const unpublishItemCommand = vscode.commands.registerCommand(
        'bloggerItem.unpublish',
        async (item: BloggerTreeItem | undefined) => {
            if (!item?.id) {
                vscode.window.showErrorMessage('Could not unpublish this item because its Blogger ID is missing.');
                return;
            }

            try {
                if (item.Type === BloggerItemType.Post) {
                    await bloggerService.unpublishPost(item.id);
                    postsProvider.refresh();
                } else if (item.Type === BloggerItemType.Page) {
                    await bloggerService.unpublishPage(item.id);
                    pagesProvider.refresh();
                } else {
                    vscode.window.showErrorMessage('This item is not a Blogger post or page.');
                    return;
                }

                vscode.window.showInformationMessage(`"${item.label}" was unpublished successfully.`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to unpublish "${item.label}": ${error}`);
            }
        }
    );

    const deleteItemCommand = vscode.commands.registerCommand(
        'bloggerItem.delete',
        async (item: BloggerTreeItem | undefined) => {
            const isPost = item?.Type === BloggerItemType.Post;
            const isPage = item?.Type === BloggerItemType.Page;
            const isLocalPublished = item?.contextValue === 'bloggerPost_localPublished'
                || item?.contextValue === 'bloggerPage_localPublished';
            const isDraft = item?.contextValue === 'bloggerPost_draft'
                || item?.contextValue === 'bloggerPost_localDraft'
                || item?.contextValue === 'bloggerPage_draft'
                || item?.contextValue === 'bloggerPage_localDraft';

            if (!item || (!isPost && !isPage) || (!isDraft && !isLocalPublished)) {
                vscode.window.showErrorMessage('Only draft items and local copies of published items can be deleted.');
                return;
            }

            const confirmation = await vscode.window.showWarningMessage(
                isLocalPublished
                    ? `Delete the local copy of "${item.label}"? The published Blogger item will not be deleted.`
                    : `Delete draft "${item.label}"? This cannot be undone.`,
                { modal: true },
                'Delete'
            );
            if (confirmation !== 'Delete') {
                return;
            }

            try {
                if (isLocalPublished) {
                    if (!item.LocalFilePath) {
                        throw new Error('The local copy file path is missing.');
                    }
                    const localFileUri = vscode.Uri.file(item.LocalFilePath);
                    await vscode.workspace.fs.delete(localFileUri, { useTrash: true });
                    await deleteLocalDraftMetadata(localFileUri);
                } else if (item.LocalFilePath) {
                    const localFileUri = vscode.Uri.file(item.LocalFilePath);
                    await vscode.workspace.fs.delete(localFileUri, { useTrash: true });
                    await deleteLocalDraftMetadata(localFileUri);
                } else if (item.id && isPost) {
                    await bloggerService.deletePost(item.id);
                } else if (item.id && isPage) {
                    await bloggerService.deletePage(item.id);
                } else {
                    throw new Error('The draft has neither a local file nor a Blogger ID.');
                }

                if (isPost) {
                    if (isLocalPublished) {
                        postsProvider.refreshLocal();
                    } else {
                        postsProvider.refresh();
                    }
                } else {
                    if (isLocalPublished) {
                        pagesProvider.refreshLocal();
                    } else {
                        pagesProvider.refresh();
                    }
                }
                vscode.window.showInformationMessage(
                    isLocalPublished
                        ? `The local copy of "${item.label}" was deleted. The Blogger item was not changed.`
                        : `"${item.label}" was deleted.`
                );
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to delete "${item.label}": ${error}`);
            }
        }
    );

    const previewItemCommand = vscode.commands.registerCommand(
        'bloggerItem.preview',
        async (item: BloggerTreeItem | undefined) => {
            const isPublishedPost = item?.Type === BloggerItemType.Post
                && item.contextValue === 'bloggerPost_published';
            const isPublishedPage = item?.Type === BloggerItemType.Page
                && item.contextValue === 'bloggerPage_published';

            if (!item || (!isPublishedPost && !isPublishedPage)) {
                vscode.window.showErrorMessage('Only published Blogger posts and pages can be previewed.');
                return;
            }

            if (!item.Url) {
                vscode.window.showErrorMessage('This published item does not have a URL to preview.');
                return;
            }

            const uri = vscode.Uri.parse(item.Url);
            if (!['http', 'https'].includes(uri.scheme)) {
                vscode.window.showErrorMessage('This published item has an invalid URL.');
                return;
            }

            try {
                await vscode.commands.executeCommand('simpleBrowser.show', uri.toString());
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to preview "${item.label}": ${error}`);
            }
        }
    );

    const selectBlogContextCommand = vscode.commands.registerCommand(
        'bloggerBlogs.select',
        async (item: vscode.TreeItem) => {
            if (!item.id) {
                return;
            }

            const currentBlogId = vscode.workspace
                .getConfiguration('blogger')
                .get<string>('selectedBlogId');

            if (currentBlogId === item.id) {
                return;
            }

            await vscode.workspace.getConfiguration('blogger').update(
                'selectedBlogId',
                item.id,
                vscode.ConfigurationTarget.Global
            );
        }
    );

    const openBlogContextCommand = vscode.commands.registerCommand(
        'bloggerItem.open',
        async (item: BloggerTreeItem) => {
            if (!item?.Url) {
                vscode.window.showWarningMessage('This blog does not have a valid URL to open.');
                return;
            }

            try {
                const blogUri = vscode.Uri.parse(item.Url);
                if (!['http', 'https'].includes(blogUri.scheme)) {
                    vscode.window.showWarningMessage('This blog does not have a valid URL to open.');
                    return;
                }

                const opened = await vscode.env.openExternal(blogUri);
                if (!opened) {
                    vscode.window.showErrorMessage('Could not open the Blogger blog URL.');
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to open Blogger blog: ${error}`);
            }
        }
    );

    const selectBlogCommand = vscode.commands.registerCommand('blogger.selectBlog', async () => {
        try {
            if (!await authManager.isAuthenticated()) {
                const authenticate = await vscode.window.showWarningMessage(
                    'You need to authenticate with Blogger first.',
                    'Authenticate'
                );
                if (authenticate) {
                    await vscode.commands.executeCommand('blogger.authenticate');
                }
                return;
            }

            const blogs = await bloggerService.getBlogs();
            
            if (blogs.length === 0) {
                vscode.window.showWarningMessage('No blogs found in your Blogger account.');
                return;
            }

            const selectedBlog = await vscode.window.showQuickPick(
                blogs.map(blog => ({
                    label: blog.name,
                    description: blog.url,
                    blogId: blog.id
                })),
                {
                    placeHolder: 'Select a blog to publish to'
                }
            );

            if (selectedBlog) {
                const config = vscode.workspace.getConfiguration('blogger');
                await config.update('selectedBlogId', selectedBlog.blogId, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`Selected blog: ${selectedBlog.label}`);
            }

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load blogs: ${error}`);
        }
    });

    /* Add commands to subscriptions */
    context.subscriptions.push(
        authenticateCommand,
        getDriveFoldersCommand,
        listFolderContentCommand,
        selectBlogCommand,
        selectBlogContextCommand,
        openBlogContextCommand,
        modifyPageCommand,
        modifyPostCommand,
        publishItemCommand,
        unpublishItemCommand,
        deleteItemCommand,
        previewItemCommand,
        refreshPagesCommand,
        refreshPostsCommand,
        refreshBlogsCommand,
        newPagesCommand,
        newPostsCommand,
        saveDraftCommand,
        editPostLabelsCommand,
        selectedBlogChangeListener,
        ...infoSelectionListeners,
        ...localDraftWatchers,
        postsTreeView,
        pagesTreeView,
        blogsTreeView,
        bloggerInfoTreeView
    );

    /* Show welcome message on first activation */
    const hasShownWelcome = context.globalState.get<boolean>('hasShownWelcome');
    if (!hasShownWelcome) {
        vscode.window.showInformationMessage(
            'Welcome to Blogger Publisher! Set up your Google OAuth credentials in settings to get started.',
            'Open Settings'
        ).then(selection => {
            if (selection === 'Open Settings') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'blogger');
            }
        });
        context.globalState.update('hasShownWelcome', true);
    }
}

export function deactivate() {}
