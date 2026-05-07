/**
 * main.js — Application entry point.
 * Mounts the Svelte App component onto #app.
 */

import App from './ui/App.svelte';

const app = new App({ target: document.getElementById('app') });

export default app;
