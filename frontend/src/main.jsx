/**
 * main.jsx — multi-user PINJ start-up.
 * The sign-in page comes first (Auth.jsx). The app's own pages are loaded only after the
 * user is signed in, so their saved settings (localStorage) are read for that user.
 */
import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { AuthGate } from "./Auth.jsx";
import CinematicTheme from "./CinematicTheme.jsx";

const App = lazy(() => import("./App.jsx"));
const LiveFeed = lazy(() => import("./LiveFeed.jsx"));
const PacketSimulator = lazy(() => import("./PacketSimulator.jsx"));

const path = window.location.pathname;
const Page = path === "/live" ? LiveFeed : path === "/simulator" ? PacketSimulator : App;

ReactDOM.createRoot(document.getElementById("root")).render(
  <AuthGate render={() => (
    <>
      <Suspense fallback={<div style={{ position: "fixed", inset: 0, background: "#05090a" }} />}>
        <Page />
      </Suspense>
      <CinematicTheme />
    </>
  )} />
);
