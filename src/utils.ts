import * as vscode from 'vscode';

export class Logger {
    private static outputChannel = vscode.window.createOutputChannel('Blogger Publisher');

    static info(message: string) {
        this.outputChannel.appendLine(`[INFO] ${new Date().toISOString()}: ${message}`);
    }

    static error(message: string, error?: any) {
        this.outputChannel.appendLine(`[ERROR] ${new Date().toISOString()}: ${message}`);
        if (error) {
            this.outputChannel.appendLine(`[ERROR] ${error.toString()}`);
        }
        this.outputChannel.show();
    }

    static warn(message: string) {
        this.outputChannel.appendLine(`[WARN] ${new Date().toISOString()}: ${message}`);
    }

    static debug(message: string) {
        this.outputChannel.appendLine(`[DEBUG] ${new Date().toISOString()}: ${message}`);
    }
}

export class Utils {
    static async showProgress<T>(
        title: string,
        task: (progress: vscode.Progress<{ increment?: number; message?: string }>) => Promise<T>
    ): Promise<T> {
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title,
            cancellable: false
        }, task);
    }

    static async confirmAction(message: string, action: string = 'Confirm'): Promise<boolean> {
        const result = await vscode.window.showWarningMessage(message, action, 'Cancel');
        return result === action;
    }

    static sanitizeFilename(filename: string): string {
        return filename
            .replace(/[^a-z0-9]/gi, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .toLowerCase();
    }

    static truncateText(text: string, maxLength: number = 50): string {
        if (text.length <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength - 3) + '...';
    }

    static isValidUrl(string: string): boolean {
        try {
            // Use a simple regex instead of URL constructor for better compatibility
            const urlPattern = /^https?:\/\/.+/;
            return urlPattern.test(string);
        } catch (_) {
            return false;
        }
    }

    static async fileExists(uri: vscode.Uri): Promise<boolean> {
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
}
