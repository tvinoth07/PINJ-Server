/**
 * apiBase.js — where the PINJ hub is, for every fetch() and WebSocket in the app.
 *
 * PINJ serves its own pages: open http://<server-ip>:8080 from any PC on the network and
 * the hub is that same address (the sign-in cookie belongs to it). The Vite dev server
 * (port 7080, `npm run dev`) forwards every PINJ call to :8080, so it is the page origin too.
 */
const loc = typeof window !== "undefined" ? window.location : { origin: "http://localhost:8080" };

export const API_BASE = loc.origin;
export const WS_BASE = API_BASE.replace(/^http/, "ws");
