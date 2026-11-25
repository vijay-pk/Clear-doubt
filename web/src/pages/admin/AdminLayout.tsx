import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { Button } from "../../components/ui";
import AccountSettings from "../../components/AccountSettings";

const nav = [
  { to: "/admin", label: "Overview", icon: "◎", end: true },
  { to: "/admin/queue", label: "Approval queue", icon: "✓" },
  { to: "/admin/knowledge", label: "Knowledge", icon: "📚" },
  { to: "/admin/students", label: "Students", icon: "🎓" },
  { to: "/admin/delivery", label: "Delivery", icon: "📤" },
  { to: "/admin/settings", label: "Settings", icon: "⚙︎" },
  { to: "/admin/users", label: "Users", icon: "👥" },
  { to: "/admin/audit", label: "Audit", icon: "🧾" },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const [accountOpen, setAccountOpen] = useState(false);
  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="hidden w-60 shrink-0 flex-col p-4 md:flex" style={{ borderRight: "1px solid var(--border)" }}>
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-brand)] text-sm font-bold text-white">A</div>
          <span className="font-semibold">Adways Admin</span>
        </div>
        <nav className="flex-1 space-y-1">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition"
              style={({ isActive }) => (isActive ? { background: "var(--surface)", boxShadow: "var(--shadow)", color: "var(--text)" } : { color: "var(--text-soft)" })}
            >
              <span className="w-5 text-center">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 border-t pt-4 text-sm" style={{ borderColor: "var(--border)" }}>
          <div className="mb-2 px-2">
            <div className="font-medium">{user?.name}</div>
            <div className="text-xs" style={{ color: "var(--text-soft)" }}>{user?.role}</div>
          </div>
          <Button variant="ghost" className="w-full justify-start" onClick={() => setAccountOpen(true)}>My account</Button>
          <Button variant="ghost" className="w-full justify-start" onClick={() => logout()}>Sign out</Button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="flex items-center justify-between px-4 py-3 md:hidden" style={{ borderBottom: "1px solid var(--border)" }}>
        <span className="font-semibold">Adways Admin</span>
        <div className="flex items-center">
          <Button variant="ghost" onClick={() => setAccountOpen(true)}>My account</Button>
          <Button variant="ghost" onClick={() => logout()}>Sign out</Button>
        </div>
      </header>

      {accountOpen && <AccountSettings onClose={() => setAccountOpen(false)} />}

      <main className="flex-1 overflow-y-auto p-4 pb-24 md:p-8">
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t py-2 md:hidden" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        {nav.slice(0, 5).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="flex flex-col items-center gap-0.5 px-2 text-[10px]"
            style={({ isActive }) => ({ color: isActive ? "var(--color-brand)" : "var(--text-soft)" })}>
            <span className="text-lg">{n.icon}</span>
            {n.label.split(" ")[0]}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
