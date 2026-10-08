import * as vscode from 'vscode';

/**
 * Builds the webview document.
 *
 * Security rules enforced here:
 *   - every asset is loaded through `webview.asWebviewUri`
 *   - scripts are allowed only with a per-render nonce (no inline JS)
 *   - the CSP forbids everything else, including network access
 */
export function renderWebviewHtml(webview: vscode.Webview, distUri: vscode.Uri): string {
  const nonce = createNonce();
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'main.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'main.css'));

  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>KESTREL</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}
