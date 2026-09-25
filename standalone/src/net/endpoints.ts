// Where the game server lives. By default: same host as the page, port 2567.
// Set VITE_SERVER_URL (and optionally VITE_API_URL) at build time for production.

export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL
  ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname}:2567`;

export const API_URL: string = import.meta.env.VITE_API_URL ?? `${SERVER_URL.replace(/^ws/, 'http')}/api`;
