import { Bell, LogOut } from "lucide-react";
import { useAuth } from "../../context/useAuth.js";

function initialsFromName(name) {
  if (typeof name !== "string" || !name.trim()) {
    return "ST";
  }
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "ST";
}

function Topbar() {
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-gray-200 bg-white/90 px-5 backdrop-blur lg:px-8">
      <div className="ml-auto flex items-center gap-4">
        <button
          className="relative rounded-lg p-2 text-gray-500 hover:bg-gray-100"
          aria-label="Notifications"
        >
          <Bell size={20} />

          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#527A65]" />
        </button>

        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#E7EDE8] text-sm font-semibold text-[#42634F]"
            title={user?.name || "Staff"}
          >
            {initialsFromName(user?.name)}
          </div>
          <button
            type="button"
            onClick={() => logout()}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-gray-600 transition hover:bg-gray-100 hover:text-gray-900"
          >
            <LogOut size={16} />
            Log out
          </button>
        </div>
      </div>
    </header>
  );
}

export default Topbar;
