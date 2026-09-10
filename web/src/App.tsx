import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import LandingPage from "./screens/LandingPage";
import AppShell from "./screens/shell/AppShell";
import ErrorBoundary from "./screens/shared/ErrorBoundary";

// The design-system scratch route is never on a visitor's path: lazy chunk.
const KitScreen = lazy(() => import("./screens/KitScreen"));

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
