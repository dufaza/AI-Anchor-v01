import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

console.log('SmartAnchor: Initializing...');

// Register Service Worker for PWA Offline Functionality
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Using a relative path './sw.js' ensures the Service Worker is registered 
    // on the current origin, resolving the 'origin mismatch' error in sandboxed environments.
    navigator.serviceWorker.register('./sw.js')
      .then((registration) => {
        console.log('SmartAnchor: ServiceWorker registered with scope: ', registration.scope);
      })
      .catch((error) => {
        // Some browser environments (like restricted iframes or dynamic subdomains) 
        // block Service Workers by policy. We log a warning instead of an error 
        // to acknowledge this environment limitation without impacting app launch.
        console.warn('SmartAnchor: ServiceWorker registration skipped/failed: ', error.message);
      });
  });
}

const container = document.getElementById('root');
if (!container) {
    console.error('SmartAnchor: FATAL - Root element not found');
} else {
    const root = createRoot(container);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    console.log('SmartAnchor: Mounted successfully');
}
