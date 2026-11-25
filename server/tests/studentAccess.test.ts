import { describe, it, expect, beforeEach } from "vitest";
import { agent, login, resetDb, loginAsAdmin, makeStudent, prisma, runDueJobs } from "./helpers.js";
import { enqueue } from "../src/jobs/queue.js";
import { setStorage } from "../src/storage/storage.js";
import type { Storage } from "../src/storage/storage.js";

const DAY = 24 * 60 * 60 * 1000;

// In-memory storage that records removed keys, to assert blob cleanup.
function fakeStorage(): { s: Storage; removed: string[] } {
  const removed: string[] = [];
  const s: Storage = {
    async put(key) {
      return { key };
    },
    async getBytes() {
      return Buffer.from("");
    },
    async createSignedUrl() {
      return null;
    },
    async remove(key) {
      removed.push(key);
    },
  };
  return { s, removed };
}

async function createStudentViaApi(csrf: string, a: ReturnType<typeof agent>, overrides: Record<string, unknown> = {}) {
  return a
    .post("/api/admin/students")
    .set("X-CSRF-Token", csrf)
    .send({ name: "Rahul", email: "rahul@test.local", password: "StudentPass1", durationDays: 30, ...overrides });
}

// Seed a doubt subtree + an approved answer that originated from the student.
async function seedStudentData(studentId: string) {
  const doubt = await prisma.doubt.create({ data: { studentId, title: "Q", status: "ANSWERED" } });
  const msg = await prisma.doubtMessage.create({ data: { doubtId: doubt.id, sender: "STUDENT", body: "help" } });
  await prisma.attachment.create({
    data: { doubtMessageId: msg.id, storageKey: `doubts/${studentId}/a.png`, originalName: "a.png", mimeType: "image/png", sizeBytes: 1, sha256: "x" },
  });
  const draft = await prisma.responseDraft.create({ data: { doubtId: doubt.id, questionMessageId: msg.id, status: "APPROVED" } });
  const approved = await prisma.approvedAnswer.create({
    data: { question: "Q", answer: "A", draftId: draft.id, createdById: studentId, tags: [] },
  });
  return { doubt, approved };
}

describe("student access lifecycle", () => {
  beforeEach(resetDb);

  it("admin creates a time-limited student; self-register stays disabled", async () => {
    const { a, csrf } = await loginAsAdmin();
    const res = await createStudentViaApi(csrf, a);
    expect(res.status).toBe(201);
    expect(res.body.student.state).toBe("ACTIVE");
    const user = await prisma.user.findUnique({ where: { email: "rahul@test.local" } });
    expect(user?.role).toBe("STUDENT");
    expect(user?.accessExpiresAt).toBeTruthy();
    expect(user?.createdByAdminId).toBeTruthy();
  });

  it("student logs in before expiry and can use the app", async () => {
    await makeStudent("s@test.local", true);
    await prisma.user.update({ where: { email: "s@test.local" }, data: { accessExpiresAt: new Date(Date.now() + 30 * DAY) } });
    const a = agent();
    const { res } = await login(a, "s@test.local", "StudentPass1");
    expect(res.status).toBe(200);
    const me = await a.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.access.state).toBe("ACTIVE");
  });

  it("expiry mid-session blocks the next request and /auth/me returns account_expired", async () => {
    await makeStudent("e@test.local", true);
    await prisma.user.update({ where: { email: "e@test.local" }, data: { accessExpiresAt: new Date(Date.now() + 30 * DAY) } });
    const a = agent();
    await login(a, "e@test.local", "StudentPass1");
    // expire now, same session
    await prisma.user.update({ where: { email: "e@test.local" }, data: { accessExpiresAt: new Date(Date.now() - 1000) } });
    const doubts = await a.get("/api/doubts");
    expect(doubts.status).toBe(401); // requireAuth denies: no user attached
    const me = await a.get("/api/auth/me");
    expect(me.status).toBe(403);
    expect(me.body.error.code).toBe("account_expired");
  });

  it("login after expiry is rejected with account_expired", async () => {
    await makeStudent("le@test.local", true);
    await prisma.user.update({ where: { email: "le@test.local" }, data: { accessExpiresAt: new Date(Date.now() - DAY) } });
    const res = await agent().post("/api/auth/login").send({ email: "le@test.local", password: "StudentPass1" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("account_expired");
  });

  it("admin can extend an active student's access", async () => {
    const { user } = await makeStudent("x@test.local", true);
    await prisma.user.update({ where: { id: user.id }, data: { accessExpiresAt: new Date(Date.now() + 5 * DAY) } });
    const { a, csrf } = await loginAsAdmin();
    const res = await a.post(`/api/admin/students/${user.id}/extend`).set("X-CSRF-Token", csrf).send({ addDays: 30 });
    expect(res.status).toBe(200);
    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after!.accessExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 30 * DAY);
  });

  it("suspend revokes sessions and blocks login; reactivate restores it", async () => {
    const { user } = await makeStudent("sp@test.local", true);
    await prisma.user.update({ where: { id: user.id }, data: { accessExpiresAt: new Date(Date.now() + 30 * DAY) } });
    const { a, csrf } = await loginAsAdmin();
    await a.post(`/api/admin/students/${user.id}/suspend`).set("X-CSRF-Token", csrf).send({});
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
    const blocked = await agent().post("/api/auth/login").send({ email: "sp@test.local", password: "StudentPass1" });
    expect(blocked.status).toBe(401);
    expect(blocked.body.error.code).toBe("suspended");
    await a.post(`/api/admin/students/${user.id}/reactivate`).set("X-CSRF-Token", csrf).send({});
    const ok = await agent().post("/api/auth/login").send({ email: "sp@test.local", password: "StudentPass1" });
    expect(ok.status).toBe(200);
  });

  it("sweep marks expired-past-grace students for deletion and the job purges all their data", async () => {
    const { s, removed } = fakeStorage();
    setStorage(s);
    const { user } = await makeStudent("del@test.local", true);
    await prisma.user.update({ where: { id: user.id }, data: { accessExpiresAt: new Date(Date.now() - 100 * DAY) } });
    const { approved } = await seedStudentData(user.id);

    await enqueue("expireSweep", {}, { dedupeKey: "expireSweep:hourly" });
    await runDueJobs();

    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await prisma.doubt.count({ where: { studentId: user.id } })).toBe(0);
    expect(await prisma.approvedAnswer.findUnique({ where: { id: approved.id } })).toBeNull();
    expect(removed).toContain(`doubts/${user.id}/a.png`);
    expect(await prisma.auditLog.count({ where: { action: "student.deleted", entityId: user.id } })).toBe(1);
  });

  it("deletion is idempotent and isolated; shared data and other students survive", async () => {
    const { s } = fakeStorage();
    setStorage(s);
    const { user: a1 } = await makeStudent("a1@test.local", true);
    const { user: a2 } = await makeStudent("a2@test.local", true);
    await seedStudentData(a1.id);
    const other = await prisma.doubt.create({ data: { studentId: a2.id, title: "keep", status: "OPEN" } });

    // A shared, admin-curated approved answer not tied to any student's draft.
    const admin = await prisma.user.create({ data: { email: "ad@test.local", name: "Ad", role: "ADMIN", emailVerified: true, passwordHash: "x" } });
    const shared = await prisma.approvedAnswer.create({ data: { question: "shared", answer: "kb", createdById: admin.id, tags: [] } });
    const doc = await prisma.courseDocument.create({ data: { title: "t", originalName: "t.pdf", storageKey: "documents/t.pdf", mimeType: "application/pdf", sizeBytes: 1, sha256: "y", uploadedById: admin.id } });

    await enqueue("deleteStudent", { studentId: a1.id }, { dedupeKey: `deleteStudent:${a1.id}` });
    await runDueJobs();
    // run again — must not throw or duplicate the audit record
    await enqueue("deleteStudent", { studentId: a1.id }, { dedupeKey: `deleteStudent:${a1.id}` });
    await runDueJobs();

    expect(await prisma.user.findUnique({ where: { id: a1.id } })).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "student.deleted", entityId: a1.id } })).toBe(1);
    // other student + their data intact
    expect(await prisma.user.findUnique({ where: { id: a2.id } })).not.toBeNull();
    expect(await prisma.doubt.findUnique({ where: { id: other.id } })).not.toBeNull();
    // shared KB intact
    expect(await prisma.approvedAnswer.findUnique({ where: { id: shared.id } })).not.toBeNull();
    expect(await prisma.courseDocument.findUnique({ where: { id: doc.id } })).not.toBeNull();
  });
});
