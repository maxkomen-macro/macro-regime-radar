import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import LandingPage from "./screens/LandingPage";
import AppShell from "./screens/shell/AppShell";
import ErrorBoundary from "./screens/shared/ErrorBoundary";

// The design-system scratch route is never on a visitor's path: lazy chunk.
const KitScreen = lazy(() => import("./screens/KitScreen"));
// The Desk (analyst workspace, desk/frame): its own shell and stylesheet in
// one chunk, so a dashboard visitor never downloads it.
const DeskShell = lazy(() => import("./screens/desk/DeskShell"));

export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <ErrorBoundary label="The landing page">
            <LandingPage />
          </ErrorBoundary>
        }
      />
      {/* Active tab lives in the URL so every tab is linkable. */}
      <Route path="/app" element={<Navigate to="/app/dashboard" replace />} />
      <Route path="/app/:tab" element={<AppShell />} />
      {/* The Desk: /desk lands on Today; /desk/<page> is linkable, and
          ?view=client is preserved by the shell (docs/desk/DESK_FRAME_SPEC.md). */}
      <Route
        path="/desk/:page?"
        element={
          <ErrorBoundary label="The Desk">
            <Suspense fallback={null}>
              <DeskShell />
            </Suspense>
          </ErrorBoundary>
        }
      />
      {/* Scratch route: every design-system component with fixture data. */}
      <Route
        path="/kit"
        element={
          <Suspense fallback={null}>
            <KitScreen />
          </Suspense>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
