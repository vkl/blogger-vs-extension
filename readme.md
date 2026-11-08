# Blogger Studio

Blogger Studio is a VS Code extension for managing Blogger blogs, posts, and pages. Create local HTML drafts, save or publish them to Blogger, modify existing items, and manage post labels.

## Requirements

- VS Code 1.145.2 or later
- A Google account with access to Blogger
- A Google Cloud project with the Blogger API v3 and Google Drive API enabled
- Google OAuth desktop client credentials

## Set up Google authentication

1. In the [Google Cloud Console](https://console.cloud.google.com/), create or select a project.
2. Enable **Blogger API v3** and **Google Drive API** for that project.
3. Configure the OAuth consent screen for your account and testing status. Add your Google account as a test user if required.
4. Create an OAuth client ID with application type **Desktop app**.
   - The extension requires the client ID and client secret.
   - Do not configure a fixed redirect URI. During authentication, the extension starts a temporary local server and uses an available loopback port.
5. In VS Code, open **Settings** and search for `blogger`. Set **Blogger: Client Id** and **Blogger: Client Secret**.
6. Open the Command Palette and run **Blogger: Authenticate with Blogger**. Sign in in the browser and grant access.

The extension requests access to Blogger, files it creates in Google Drive, and read-only access to Google Drive file metadata so it can list folders. Authentication tokens are stored using VS Code's SecretStorage. After updating from a version that only requested `drive.file`, run **Blogger: Authenticate with Blogger** again and grant the additional permission to list existing folders.

## Install

### Install a packaged extension

1. Download the `.vsix` file.
2. Open the Extensions view (`Ctrl+Shift+X`).
3. Select the **...** menu, choose **Install from VSIX...**, and select the downloaded file.

### Run from source

1. Clone this repository.
2. Run `npm install`.
3. Run `npm run compile`.
4. Press `F5` in VS Code to launch an Extension Development Host.

## Use the extension

1. Open the **Blogger** activity bar view.
2. Run **Blogger: Select Blog** in the Command Palette or select a blog from the Blogs view.
3. Use **Add Post** or **Add Page** in the corresponding view title bar to create a local HTML draft.
4. Write standard HTML in the file and save it. Markdown-to-HTML conversion is not currently available; Markdown content will not be converted automatically.
5. In the Posts or Pages view, right-click the local draft and choose:
   - **Save** to create or update the item on Blogger as a draft.
   - **Publish** to publish it directly.

Local files are organized by selected blog under `.blogger/blogs/<blogId>/posts/` and `.blogger/blogs/<blogId>/pages/`, with `drafts` and `published` subfolders. Selecting another blog switches the views to that blog's local files.

To use templates when creating drafts, place `.html` or `.htm` files in `.blogger/blogs/<blogId>/posts/templates/` or `.blogger/blogs/<blogId>/pages/templates/`. After entering a post or page title, select a template from the picker; choose **Start with a blank file** to skip template content. The new draft uses the entered title as its filename.

Run **Blogger: Get Google Drive Folders** from the Command Palette to browse folders available to the extension. The picker shows each folder's name and ID and can be filtered by either.

Run **Blogger: List Google Drive Folder Content** to list files and subfolders in the folder configured by `blogger.googleDriveImageFolder`. Set that setting to a folder name or path such as `Blog Images/2025`; the command reports if the setting is empty or the folder cannot be found.

### Work with existing items

- Right-click a cloud post or page and choose **Modify** to create/open its local copy.
- Right-click a local copy and choose **Save** to update its linked Blogger item.
- For posts, choose **Edit Labels** to edit the labels; enter comma-separated labels, or leave the field empty to remove them all.
- Published posts and pages offer **Preview** and **Unpublish**.
- **Delete** removes a selected Blogger draft, or deletes a local draft file. For a local copy of a published item, it deletes only the local file and metadata; the published Blogger item remains untouched.

## Settings

Open VS Code Settings and search for `blogger`.

| Setting | Purpose |
| --- | --- |
| `blogger.clientId` | Google OAuth desktop client ID |
| `blogger.clientSecret` | Google OAuth desktop client secret |
| `blogger.selectedBlogId` | Currently selected blog ID; set by the extension |
| `blogger.maxResults` | Maximum posts returned by a Blogger post-list request (1–500; default 50) |

## Troubleshooting

- **Authentication fails:** Verify the OAuth credentials are for a **Desktop app**, check the consent screen and test-user configuration, and ensure the Blogger and Drive APIs are enabled. The extension uses a dynamic loopback redirect; do not configure a fixed redirect URI.
- **No blog is selected:** Run **Blogger: Select Blog** and choose a blog.
- **A local copy is missing:** Confirm the selected blog is correct and check its `.blogger/blogs/<blogId>/` folder.
- **Publishing or saving fails:** Check your network connection and authentication, then review the **Blogger Studio** channel in the VS Code Output panel.

## Development

```sh
npm install
npm run compile
```

## License

MIT. See [LICENSE.txt](LICENSE.txt).
