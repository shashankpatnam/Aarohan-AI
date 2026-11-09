import { BrowserRouter, Routes, Route } from "react-router-dom";

import PublicLayout from "./components/layout/PublicLayout";
import AppLayout from "./components/layout/AppLayout";
import RequireStaff from "./components/auth/RequireStaff";
import ExploreProjects from "./pages/public/ExploreProjects";
import GuestChat from "./pages/public/GuestChat";
import Login from "./pages/Login";

import Dashboard from "./pages/Dashboard";
import Leads from "./pages/Leads";
import LeadDetails from "./pages/LeadDetails";
import Visits from "./pages/Visits";
import Analytics from "./pages/Analytics";
import Handoffs from "./pages/Handoffs";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route element={<PublicLayout />}>
          <Route index element={<ExploreProjects />} />
          <Route path="/explore" element={<ExploreProjects />} />
          <Route path="/explore/chat" element={<GuestChat />} />
        </Route>

        <Route element={<RequireStaff />}>
          <Route element={<AppLayout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/leads" element={<Leads />} />
            <Route path="/leads/:id" element={<LeadDetails />} />
            <Route path="/visits" element={<Visits />} />
            <Route path="/handoffs" element={<Handoffs />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
