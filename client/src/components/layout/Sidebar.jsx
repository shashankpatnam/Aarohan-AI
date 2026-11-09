import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/useAuth.js";

import {
  LayoutDashboard,
  Users,
  CalendarDays,
  ChartNoAxesCombined,
  HandHelping,
  Settings,
  Building2,
} from "lucide-react";

const navigation = [
  {
    name: "Overview",
    path: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    name: "Leads",
    path: "/leads",
    icon: Users,
  },
  {
    name: "Site Visits",
    path: "/visits",
    icon: CalendarDays,
  },
  {
    name: "Handoffs",
    path: "/handoffs",
    icon: HandHelping,
  },
  {
    name: "Analytics",
    path: "/analytics",
    icon: ChartNoAxesCombined,
  },
  {
    name: "Settings",
    path: "/settings",
    icon: Settings,
  },
];

function Sidebar() {
  const { user } = useAuth();

  return (
    <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-gray-200 bg-white lg:flex lg:flex-col">
      <div className="flex h-20 items-center gap-3 border-b border-gray-100 px-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#527A65] text-white">
          <Building2 size={21} />
        </div>

        <div>
          <h1 className="text-lg font-semibold tracking-tight text-gray-900">
            Aarohan
          </h1>
          <p className="text-xs text-gray-500">
            Property Concierge
          </p>
        </div>
      </div>

      <div className="px-4 py-6">
        <p className="mb-3 px-3 text-xs font-medium uppercase tracking-wider text-gray-400">
          Workspace
        </p>

        <nav className="space-y-1">
          {navigation.map((item) => {
            const Icon = item.icon;

            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                    isActive
                      ? "bg-[#EDF3EE] text-[#42634F]"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  }`
                }
              >
                <Icon size={19} strokeWidth={1.8} />
                {item.name}
              </NavLink>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto border-t border-gray-100 p-4">
        <div className="rounded-xl bg-[#FAFAF8] p-3">
          <p className="text-sm font-medium text-gray-800">
            {user?.name || "Company A"}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {user?.email || "Ahmedabad · Sales team"}
          </p>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
