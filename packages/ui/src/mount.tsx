import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { App } from './App';
import { setHostTransport, type HostTransport } from './host/host';

/**
 * Mounts the canvas into `container`, talking to the host through `transport`
 * (the VS Code webview bridge when omitted and available).
 *
 * Styles are not imported here: a bundler host imports `@kestrel/ui/styles.css`
 * and `@xyflow/react/dist/style.css` the way its own pipeline expects.
 */
export function mountKestrel(container: Element, transport?: HostTransport): Root {
  if (transport) {
    setHostTransport(transport);
  }
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  return root;
}
