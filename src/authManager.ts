import * as vscode from 'vscode';
import { google } from 'googleapis';
import * as http from 'http';
import { Logger } from './utils';

export class AuthManager {
    private oauth2Client: any;
    private server: http.Server | null = null;

    constructor(private context: vscode.ExtensionContext) {
        this.setupOAuth();
    }

    private setupOAuth(redirectUri?: string) {
        const config = vscode.workspace.getConfiguration('blogger');
        const clientId = config.get<string>('clientId');
        const clientSecret = config.get<string>('clientSecret');

        if (!clientId || !clientSecret) {
            return;
        }

        this.oauth2Client = new google.auth.OAuth2(
            clientId,
            clientSecret,
            redirectUri
        );
    }

    async authenticate(): Promise<void> {
        return new Promise((resolve, reject) => {
            const config = vscode.workspace.getConfiguration('blogger');
            const clientId = config.get<string>('clientId');
            const clientSecret = config.get<string>('clientSecret');

            if (!clientId || !clientSecret) {
                reject(new Error('Please configure your Google OAuth Client ID and Client Secret in VS Code settings.'));
                return;
            }

            let settled = false;
            const finish = (error?: unknown) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeout);
                this.stopServer();
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            };

            const server = http.createServer(async (req, res) => {
                const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
                if (req.method !== 'GET' || requestUrl.pathname !== '/oauth/callback') {
                    res.writeHead(404);
                    res.end('Not found');
                    return;
                }

                const code = requestUrl.searchParams.get('code');
                const oauthError = requestUrl.searchParams.get('error');
                if (!code) {
                    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end('Authorization failed. You can close this window.');
                    finish(new Error(oauthError
                        ? `Authorization failed: ${oauthError}`
                        : 'Authorization code not received'));
                    return;
                }

                try {
                    Logger.debug('Google OAuth API: token exchange');
                    const { tokens } = await this.oauth2Client.getToken(code);
                    this.oauth2Client.setCredentials(tokens);

                    // Store tokens securely
                    await this.context.secrets.store('blogger_access_token', tokens.access_token || '');
                    await this.context.secrets.store('blogger_refresh_token', tokens.refresh_token || '');

                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(`
                        <html>
                            <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                                <h2 style="color: green;">✅ Authentication Successful!</h2>
                                <p>You can now close this window and return to VS Code.</p>
                            </body>
                        </html>
                    `);

                    finish();
                } catch (error) {
                    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                    res.end('Authentication failed. Please return to VS Code and try again.');
                    finish(error);
                }
            });

            const timeout = setTimeout(() => {
                finish(new Error('Authentication timeout'));
            }, 300000);

            this.server = server;
            server.once('error', finish);
            server.listen(0, '127.0.0.1', () => {
                const address = server.address();
                if (!address || typeof address === 'string') {
                    finish(new Error('Could not determine the OAuth callback server port.'));
                    return;
                }

                const redirectUri = `http://127.0.0.1:${address.port}/oauth/callback`;
                this.setupOAuth(redirectUri);
                const authUrl = this.oauth2Client.generateAuthUrl({
                    access_type: 'offline',
                    scope: [
                        'https://www.googleapis.com/auth/blogger',
                        'https://www.googleapis.com/auth/drive.file',
                        'https://www.googleapis.com/auth/drive.metadata.readonly'
                    ],
                    prompt: 'consent'
                });

                vscode.env.openExternal(vscode.Uri.parse(authUrl)).then(opened => {
                    if (!opened) {
                        finish(new Error('Could not open the browser for Blogger authentication.'));
                    }
                }, finish);
            });
        });
    }

    private stopServer() {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }

    async isAuthenticated(): Promise<boolean> {
        const accessToken = await this.context.secrets.get('blogger_access_token');
        const refreshToken = await this.context.secrets.get('blogger_refresh_token');
        return !!(accessToken && refreshToken);
    }

    async getAuthenticatedClient(): Promise<any> {
        if (!await this.isAuthenticated()) {
            throw new Error('Not authenticated');
        }

        this.setupOAuth();
        
        const accessToken = await this.context.secrets.get('blogger_access_token');
        const refreshToken = await this.context.secrets.get('blogger_refresh_token');

        this.oauth2Client.setCredentials({
            access_token: accessToken,
            refresh_token: refreshToken
        });

        // Handle token refresh
        this.oauth2Client.on('tokens', async (tokens: any) => {
            if (tokens.refresh_token) {
                await this.context.secrets.store('blogger_refresh_token', tokens.refresh_token);
            }
            if (tokens.access_token) {
                await this.context.secrets.store('blogger_access_token', tokens.access_token);
            }
        });

        return this.oauth2Client;
    }
}
