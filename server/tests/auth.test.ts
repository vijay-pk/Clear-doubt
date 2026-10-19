import { describe, it, expect, beforeEach } from "vitest";
import { agent, resetDb, makeStudent, loginAsStudent, loginAsAdmin, login, prisma } from "./helpers.js";
import { consumeToken } from "../src/auth/authService.js";

describe("auth & roles", () => {
  beforeEach(resetDb);

  it("1. student can register and is active immediately (no verification)", async () => {
    const a = agent();
    const res = await a.post("/api/auth/register").send({ email: "new@test.local", name: "New Student", password: "Password123" });
    expect(res.status).toBe(201);
    const user = await prisma.user.findUnique({ where: { email: "new@test.local" } });
    expect(user?.emailVerified).toBe(true);
    expect(user?.role).toBe("STUDENT");
    const tok = await prisma.verificationToken.count({ where: { userId: user!.id, purpose: "EMAIL_VERIFY" } });
    expect(tok).toBe(0);
  });

  it("2. students can ask doubts without email verification", async () => {
    await makeStudent("unv@test.local", false);
    const a = agent();
    const { csrf } = await login(a, "unv@test.local", "StudentPass1");
    const res = await a.post("/api/doubts").set("X-CSRF-Token", csrf).field("body", "hi");
    expect(res.status).toBe(201);
  });

  it("3. seeded admin logs in and is routed to the dashboard", async () => {
    const { email, password } = await (await import("./helpers.js")).seedAdmin("SUPER_ADMIN");
    const a = agent();
    const res = await a.post("/api/auth/login").send({ email, password });
    expect(res.status).toBe(200);
    expect(res.body.redirect).toBe("/admin");
    expect(res.body.user.role).toBe("SUPER_ADMIN");
  });

  it("4. student is routed to chat and cannot reach admin APIs", async () => {
    const { a } = await loginAsStudent();
    const me = await a.get("/api/auth/me");
    expect(me.body.user.role).toBe("STUDENT");
    const admin = await a.get("/api/admin/queue");
    expect(admin.status).toBe(403);
  });

  it("5. wrong password is rejected", async () => {
    await makeStudent("wrong@test.local", true);
    const res = await agent().post("/api/auth/login").send({ email: "wrong@test.local", password: "nope" });
    expect(res.status).toBe(401);
  });

  it("admin login works end to end", async () => {
    const { a } = await loginAsAdmin();
    const res = await a.get("/api/admin/stats");
    expect(res.status).toBe(200);
    expect(res.body.stats).toBeDefined();
  });

  it("email verification token flow marks the user verified", async () => {
    const a = agent();
    const reg = await a.post("/api/auth/register").send({ email: "v@test.local", name: "Vera", password: "Password123" });
    expect(reg.status).toBe(201);
    const user = await prisma.user.findUnique({ where: { email: "v@test.local" } });
    // simulate the emailed token by issuing one we can read
    const { issueToken } = await import("../src/auth/authService.js");
    const token = await issueToken(user!.id, "EMAIL_VERIFY");
    const res = await a.post("/api/auth/verify-email").send({ token });
    expect(res.status).toBe(200);
    const after = await prisma.user.findUnique({ where: { id: user!.id } });
    expect(after?.emailVerified).toBe(true);
    // token cannot be reused
    await expect(consumeToken(token, "EMAIL_VERIFY")).rejects.toThrow();
  });
});
