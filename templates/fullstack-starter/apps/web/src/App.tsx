import { UsersPage } from './pages/UsersPage';

export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '48px auto', padding: '0 16px' }}>
      <h1>My App</h1>
      <p>Built with KESTREL. Select a component on the canvas and ask the agent to change it.</p>
      <UsersPage />
    </main>
  );
}
