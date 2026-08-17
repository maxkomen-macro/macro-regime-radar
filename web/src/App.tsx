import { Navigate, Route, Routes } from "react-router-dom";
import LandingPage from "./screens/LandingPage";
import AppShell from "./screens/shell/AppShell";
import KitScreen from "./screens/KitScreen";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      {/* Active tab lives in the URL so every tab is linkable. */}
      <Route path="/app" element={<Navigate to="/app/dashboard" replace />} />
      <Route path="/app/:tab" element={<AppShell />} />
      {/* Scratch route: every design-system component with fixture data. */}
      <Route path="/kit" element={<KitScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
