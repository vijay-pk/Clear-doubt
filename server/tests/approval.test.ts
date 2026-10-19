import { describe, it, expect, beforeEach } from "vitest";
import { agent, resetDb, makeStudent, login, loginAsAdmin, runDueJobs, prisma } from "./helpers.js";

async function studentDoubt(email: string, body: string) {
  await makeStudent(email, true);
  const a = agent();
  const { csrf } = await login(a, email, "StudentPass1");
  const r = await a.post("/api/doubts").set("X-CSRF-Token", csrf).field("body", body);
  await runDueJobs();
  const draft = await prisma.responseDraft.findFirstOrThrow();
  return { a, csrf, doubtId: r.body.doubt.id, draftId: draft.id };
}

describe("mandatory approval workflow", () => {
  beforeEach(resetDb);

  it("9. approving a draft delivers it (website message + ANSWERED + email log)", async () => {
    const { doubtId, draftId } = await studentDoubt("a9@test.local", "Explain supply and demand");
    const { a: admin, csrf } = await loginAsAdmin();
    const res = await admin.post(`/api/admin/drafts/${draftId}/approve`).set("X-CSRF-Token", csrf).send({});
    expect(res.status).toBe(200);
    await runDueJobs();

    const doubt = await prisma.doubt.findUniqueOrThrow({ where: { id: doubtId }, include: { messages: true } });
    expect(doubt.status).toBe("ANSWERED");
    expect(doubt.messages.some((m) => m.sender === "TUTOR")).toBe(true);
    const website = await prisma.deliveryLog.findFirst({ where: { channel: "WEBSITE", status: "SENT" } });
    expect(website).toBeTruthy();
    const email = await prisma.deliveryLog.findFirst({ where: { channel: "EMAIL" } });
    expect(email).toBeTruthy();
    const draft = await prisma.responseDraft.findUniqueOrThrow({ where: { id: draftId } });
    expect(draft.status).toBe("SENT");
  });

  it("10. editing before approve sends the edited text", async () => {
    const { doubtId, draftId } = await studentDoubt("a10@test.local", "What is inflation?");
    const { a: admin, csrf } = await loginAsAdmin();
    await admin.post(`/api/admin/drafts/${draftId}/approve`).set("X-CSRF-Token", csrf).send({ editedText: "Edited tutor answer." });
    await runDueJobs();
    const doubt = await prisma.doubt.findUniqueOrThrow({ where: { id: doubtId }, include: { messages: true } });
    const tutor = doubt.messages.find((m) => m.sender === "TUTOR");
    expect(tutor?.body).toBe("Edited tutor answer.");
  });

  it("11. rejecting sends nothing", async () => {
    const { doubtId, draftId } = await studentDoubt("a11@test.local", "Reject me");
    const { a: admin, csrf } = await loginAsAdmin();
    await admin.post(`/api/admin/drafts/${draftId}/reject`).set("X-CSRF-Token", csrf).send({ reason: "off-topic" });
    await runDueJobs();
    const tutor = await prisma.doubtMessage.count({ where: { sender: "TUTOR", doubtId } });
    expect(tutor).toBe(0);
    const draft = await prisma.responseDraft.findUniqueOrThrow({ where: { id: draftId } });
    expect(draft.status).toBe("REJECTED");
  });

  it("12. regenerate rebuilds a pending draft", async () => {
    const { draftId } = await studentDoubt("a12@test.local", "Regenerate this");
    const { a: admin, csrf } = await loginAsAdmin();
    await admin.post(`/api/admin/drafts/${draftId}/regenerate`).set("X-CSRF-Token", csrf).send({});
    await runDueJobs();
    const draft = await prisma.responseDraft.findUniqueOrThrow({ where: { id: draftId } });
    expect(draft.status).toBe("PENDING_APPROVAL");
  });

  it("request more details sends a clarification and leaves the doubt awaiting the student", async () => {
    const { doubtId, draftId } = await studentDoubt("rd@test.local", "vague question");
    const { a: admin, csrf } = await loginAsAdmin();
    const r = await admin.post(`/api/admin/drafts/${draftId}/request-details`).set("X-CSRF-Token", csrf).send({ message: "Please share more context." });
    expect(r.status).toBe(200);
    await runDueJobs();
    const doubt = await prisma.doubt.findUniqueOrThrow({ where: { id: doubtId }, include: { messages: true } });
    expect(doubt.status).toBe("AWAITING_STUDENT");
    expect(doubt.messages.find((m) => m.sender === "TUTOR")?.body).toBe("Please share more context.");
  });

  it("13. delivery is idempotent — running jobs twice sends once", async () => {
    const { doubtId, draftId } = await studentDoubt("a13@test.local", "Idempotency check");
    const { a: admin, csrf } = await loginAsAdmin();
    await admin.post(`/api/admin/drafts/${draftId}/approve`).set("X-CSRF-Token", csrf).send({});
    await runDueJobs();
    await runDueJobs(); // run again
    const tutor = await prisma.doubtMessage.count({ where: { sender: "TUTOR", doubtId } });
    expect(tutor).toBe(1);
    const emailLogs = await prisma.deliveryLog.count({ where: { channel: "EMAIL" } });
    expect(emailLogs).toBe(1);
  });
});
