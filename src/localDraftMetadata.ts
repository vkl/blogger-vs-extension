import * as vscode from 'vscode';

export type LocalDraftKind = 'post' | 'page';

export interface LocalDraftMetadata {
    kind: LocalDraftKind;
    bloggerId: string;
    blogId: string;
    status?: 'DRAFT' | 'LIVE';
}

export function getLocalDraftMetadataUri(fileUri: vscode.Uri): vscode.Uri {
    return vscode.Uri.file(`${fileUri.fsPath}.blogger.json`);
}

export async function readLocalDraftMetadata(fileUri: vscode.Uri): Promise<LocalDraftMetadata | undefined> {
    const metadataUri = getLocalDraftMetadataUri(fileUri);
    if (!(await fileExists(metadataUri))) {
        return undefined;
    }

    const content = Buffer.from(await vscode.workspace.fs.readFile(metadataUri)).toString('utf8');
    const metadata = JSON.parse(content) as LocalDraftMetadata;
    if (
        (metadata.kind !== 'post' && metadata.kind !== 'page')
        || !metadata.bloggerId
        || !metadata.blogId
    ) {
        throw new Error(`Invalid local draft metadata: ${metadataUri.fsPath}`);
    }
    return metadata;
}

export async function writeLocalDraftMetadata(
    fileUri: vscode.Uri,
    metadata: LocalDraftMetadata
): Promise<void> {
    const metadataUri = getLocalDraftMetadataUri(fileUri);
    await vscode.workspace.fs.writeFile(
        metadataUri,
        Buffer.from(JSON.stringify(metadata, null, 2), 'utf8')
    );
}

export async function deleteLocalDraftMetadata(fileUri: vscode.Uri): Promise<void> {
    const metadataUri = getLocalDraftMetadataUri(fileUri);
    if (await fileExists(metadataUri)) {
        await vscode.workspace.fs.delete(metadataUri);
    }
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch (error) {
        if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
            return false;
        }
        throw error;
    }
}
