import '@xyflow/react/dist/style.css';
import './styles.css';
import './webview.css';

import { mountKestrel } from './mount';

/** Entry point of the VS Code webview bundle. */
const container = document.getElementById('root');

if (container) {
  mountKestrel(container);
}
