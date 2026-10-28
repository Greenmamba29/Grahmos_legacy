import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { RuntimeProvider } from './app/store';
import { getRuntime } from './app/runtime';
import { registerSW } from 'virtual:pwa-register';
import './styles/console.css';

const runtime = getRuntime();

// Offline-first shell: the service worker precaches every build asset. Updates are offered, never
// forced, so an operator mid-incident is not reloaded under their feet.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  registerSW({
    immediate: true,
    onNeedRefresh: () => runtime.setSwUpdateReady(true),
    onOfflineReady: () => runtime.recheckShell(),
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RuntimeProvider runtime={runtime}>
      <App />
    </RuntimeProvider>
  </React.StrictMode>,
);
