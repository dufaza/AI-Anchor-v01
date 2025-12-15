import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

console.log('SmartAnchor: Initializing...');

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