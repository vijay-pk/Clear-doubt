import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./lib/auth";
import { Spinner } from "./components/ui";
import Login from "./pages/Login";
import AccountExpired from "./pages/AccountExpired";
import ChangePassword from "./pages/ChangePassword";
import VerifyEmail from "./pages/VerifyEmail";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Chat from "./pages/student/Chat";
import AdminLayout from "./pages/admin/AdminLayout";
import Dashboard from "./pages/admin/Dashboard";
import Queue from "./pages/admin/Queue";
import Knowledge from "./pages/admin/Knowledge";
import Settings from "./pages/admin/Settings";
import DeliveryLogs from "./pages/admin/DeliveryLogs";
import Users from "./pages/admin/Users";
import Students from "./pages/admin/Students";
import Audit from "./pages/admin/Audit";

function FullScreenSpinner() {
  return (
    <div className="flex h-full items-center justify-center" style={{ color: "var(--color-brand)" }}>
      <Spinner size={28} />
    </div>
  );
}

function Protected({ roles, children }: { roles: Array<"SUPER_ADMIN" | "ADMIN" | "STUDENT">; children: ReactNode }) {
  const { user, blocked, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <FullScreenSpinner />;
  if (!user) return <Navigate to={blocked ? "/account-expired" : "/login"} state={{ from: loc.pathname }} replace />;
  // A student still on the temporary password must change it before anything else.
  if (user.role === "STUDENT" && user.mustChangePassword) return <Navigate to="/change-password" replace />;
  if (!roles.includes(user.role)) return <Navigate to={user.role === "STUDENT" ? "/chat" : "/admin"} replace />;
  return <>{children}</>;
}

export default function App() {
  const { user, blocked, loading } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/account-expired" element={user ? <Navigate to={user.role === "STUDENT" ? "/chat" : "/admin"} replace /> : <AccountExpired />} />
      <Route path="/change-password" element={loading ? <FullScreenSpinner /> : user ? <ChangePassword /> : <Navigate to="/login" replace />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route path="/chat" element={<Protected roles={["STUDENT"]}><Chat /></Protected>} />

      <Route path="/admin" element={<Protected roles={["ADMIN", "SUPER_ADMIN"]}><AdminLayout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="queue" element={<Queue />} />
        <Route path="knowledge" element={<Knowledge />} />
        <Route path="delivery" element={<DeliveryLogs />} />
        <Route path="settings" element={<Settings />} />
        <Route path="students" element={<Students />} />
        <Route path="users" element={<Users />} />
        <Route path="audit" element={<Audit />} />
      </Route>

      <Route
        path="*"
        element={
          loading ? <FullScreenSpinner /> : <Navigate to={user ? (user.role === "STUDENT" ? "/chat" : "/admin") : blocked ? "/account-expired" : "/login"} replace />
        }
      />
    </Routes>
  );
}
