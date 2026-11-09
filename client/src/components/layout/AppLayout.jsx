import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

function AppLayout() {
  const { pathname } = useLocation();
  const isLeadsPage = pathname === "/leads";
  const isVisitsPage = pathname === "/visits";
  const isHandoffsPage = pathname === "/handoffs";
  const isViewportPage = isLeadsPage || isVisitsPage || isHandoffsPage;

  return (
    <div className={`bg-[#FAFAF8] ${isVisitsPage || isHandoffsPage ? "h-dvh overflow-hidden" : "min-h-screen"}`}>
      <Sidebar />

      <div className={`${isVisitsPage || isHandoffsPage ? "flex h-full min-h-0 flex-col" : "min-h-screen"} lg:ml-64 ${isLeadsPage ? "lg:flex lg:h-screen lg:min-h-0 lg:flex-col lg:overflow-hidden" : isVisitsPage || isHandoffsPage ? "lg:flex lg:h-dvh lg:min-h-0 lg:flex-col lg:overflow-hidden" : ""}`}>
        <Topbar />

        <main className={`${isVisitsPage || isHandoffsPage ? "flex min-h-0 flex-1 flex-col overflow-hidden p-3 sm:p-5" : "p-5"} lg:p-8 ${isViewportPage ? "lg:flex-1 lg:min-h-0 lg:overflow-hidden" : ""}`}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default AppLayout;
