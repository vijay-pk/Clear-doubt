import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";
import { Button, Card, Field, Input, PasswordInput } from "./ui";

// Self-service account settings for every signed-in user (students and admins):
// name, email, WhatsApp number and password.
export default function AccountSettings({ onClose }: { onClose: () => void }) {
  const { user, refresh } = useAuth();
  const toast = useToast();

  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [profilePassword, setProfilePassword] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [phone, setPhone] = useState(user?.phone ?? "");
  const [savingPhone, setSavingPhone] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  const emailChanged = email.trim().toLowerCase() !== (user?.email ?? "").toLowerCase();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const errMsg = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await api.post("/auth/profile", { name, email, currentPassword: emailChanged ? profilePassword : undefined });
      toast("Profile updated.", "success");
      setProfilePassword("");
      refresh();
    } catch (err) {
      toast(errMsg(err, "Could not update your profile"), "error");
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePhone(e: React.FormEvent) {
    e.preventDefault();
    setSavingPhone(true);
    try {
      const res = await api.post<{ phone: string }>("/auth/phone", { phone });
      setPhone(res.phone);
      toast("WhatsApp number saved.", "success");
      refresh();
    } catch (err) {
      toast(errMsg(err, "Could not save the number"), "error");
    } finally {
      setSavingPhone(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setSavingPw(true);
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      toast("Password changed.", "success");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      toast(errMsg(err, "Could not change the password"), "error");
    } finally {
      setSavingPw(false);
    }
  }

  const section = "space-y-3 pt-5";
  const divider = { borderTop: "1px solid var(--border)" };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(e) => e.stopPropagation()}>
        <Card>
          <div className="mb-1 flex items-center justify-between">
            <h2 id="settings-title" className="text-lg font-semibold">Settings</h2>
            <button
              onClick={onClose}
              aria-label="Close settings"
              className="flex h-8 w-8 items-center justify-center rounded-full text-xl hover:bg-black/10"
              style={{ color: "var(--text-soft)" }}
            >
              ×
            </button>
          </div>

          {user?.access && (
            <div className="space-y-1 pt-3">
              <div className="font-medium">Access</div>
              <div className="rounded-xl p-3 text-sm" style={{ background: "var(--surface-2)" }}>
                <div className="flex justify-between"><span style={{ color: "var(--text-soft)" }}>Status</span><span>{user.access.state.replace("_", " ").toLowerCase()}</span></div>
                {user.access.accessStartAt && (
                  <div className="flex justify-between"><span style={{ color: "var(--text-soft)" }}>Started</span><span>{new Date(user.access.accessStartAt).toUTCString().slice(5, 16)} UTC</span></div>
                )}
                {user.access.accessExpiresAt && (
                  <div className="flex justify-between"><span style={{ color: "var(--text-soft)" }}>Expires</span><span>{new Date(user.access.accessExpiresAt).toUTCString().slice(5, 16)} UTC</span></div>
                )}
                {user.access.remainingDays !== null && (
                  <div className="flex justify-between"><span style={{ color: "var(--text-soft)" }}>Remaining</span><span>{Math.max(0, user.access.remainingDays)} day{user.access.remainingDays === 1 ? "" : "s"}</span></div>
                )}
              </div>
            </div>
          )}

          <form onSubmit={saveProfile} className="space-y-3 pt-5" style={user?.access ? { borderTop: "1px solid var(--border)" } : undefined}>
            <div className="font-medium">Profile</div>
            <Field label="Full name">
              <Input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </Field>
            <Field label="Email (used to sign in)">
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </Field>
            {emailChanged && (
              <Field label="Current password (needed to change email)">
                <PasswordInput required value={profilePassword} onChange={(e) => setProfilePassword(e.target.value)} autoComplete="current-password" />
              </Field>
            )}
            <Button type="submit" loading={savingProfile} className="w-full">Save profile</Button>
          </form>

          <form onSubmit={savePhone} className={section} style={divider}>
            <div className="font-medium">WhatsApp number</div>
            <p className="text-xs" style={{ color: "var(--text-soft)" }}>Tutor answers are also sent to this number on WhatsApp.</p>
            <Field label="Number with country code">
              <Input type="tel" inputMode="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" />
            </Field>
            <Button type="submit" loading={savingPhone} className="w-full">Save number</Button>
          </form>

          <form onSubmit={changePassword} className={section} style={divider}>
            <div className="font-medium">Change password</div>
            <Field label="Current password">
              <PasswordInput required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
            </Field>
            <Field label="New password">
              <PasswordInput required minLength={10} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 10 characters" autoComplete="new-password" />
            </Field>
            <Button type="submit" variant="secondary" loading={savingPw} className="w-full">Change password</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
