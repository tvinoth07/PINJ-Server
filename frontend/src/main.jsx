// import { StrictMode } from "react";
// import { createRoot } from "react-dom/client";
// import App from "./App.jsx";

// createRoot(document.getElementById("root")).render(
//   <StrictMode>
//     <App />
//   </StrictMode>
// );

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import LiveFeed from "./LiveFeed.jsx";
import PacketSimulator from "./PacketSimulator.jsx";

const path = window.location.pathname;
const root = ReactDOM.createRoot(document.getElementById("root"));

if (path === "/live") {
  root.render(<LiveFeed />);
} else if (path === "/simulator") {
  root.render(<PacketSimulator />);
} else {
  root.render(<App />);
}