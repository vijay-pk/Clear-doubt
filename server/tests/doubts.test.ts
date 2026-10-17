import { describe, it, expect, beforeEach } from "vitest";
import { agent, resetDb, makeStudent, login, runDueJobs, prisma } from "./helpers.js";

async function studentAgent(email: string) {
  await makeStudent(email, true);
  const a = agent();
  const { csrf } = await login(a, email, "StudentPass1");
  return { a, csrf };
}

describe("doubts: creation, mandatory approval, scoping", () => {
  beforeEach(resetDb);

  it("6. creating a text doubt produces a draft in the queue and sends nothing", async () => {
    const { a, csrf } = await studentAgent("s6@test.local");
    const res = await a.post("/api/doubts").set("X-CSRF-Token", csrf).field("body", "What is compound interest?");
    expect(res.status).toBe(201);
    await runDueJobs();
    const drafts = await prisma.responseDraft.findMany();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.status).toBe("PENDING_APPROVAL"); // never auto-sent in default mode A
    const tutorMsgs = await prisma.doubtMessage.count({ where: { sender: "TUTOR" } });
    expect(tutorMsgs).toBe(0);
  });

  it("7. a student cannot read another student's doubt via its id (no URL tampering)", async () => {
    const alice = await studentAgent("alice@test.local");
    const r = await alice.a.post("/api/doubts").set("X-CSRF-Token", alice.csrf).field("body", "Alice's private doubt");
    const doubtId = r.body.doubt.id;

    const bob = await studentAgent("bob@test.local");
    const res = await bob.a.get(`/api/doubts/${doubtId}`);
    expect(res.status).toBe(403);
  });

  it("8. a student cannot download another student's attachment", async () => {
    const alice = await studentAgent("alice2@test.local");
    // 1x1 PNG
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    const r = await alice.a.post("/api/doubts").set("X-CSRF-Token", alice.csrf).field("body", "see photo").attach("image", png, "q.png");
    expect(r.status).toBe(201);
    const att = await prisma.attachment.findFirst();
    expect(att).toBeTruthy();

    const bob = await studentAgent("bob2@test.local");
    const res = await bob.a.get(`/api/doubts/attachments/${att!.id}`);
    expect(res.status).toBe(403);
  });

  it("image doubt that is unreadable yields a clarification draft, not a guess", async () => {
    const { a, csrf } = await studentAgent("img@test.local");
    const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    await a.post("/api/doubts").set("X-CSRF-Token", csrf).field("body", "").attach("image", tinyPng, "blurry.png");
    await runDueJobs(); // processImage -> generateAnswer
    const att = await prisma.attachment.findFirst();
    expect(att!.status).toBe("UNREADABLE"); // mock marks tiny images unreadable
    const draft = await prisma.responseDraft.findFirst();
    expect(draft!.isClarification).toBe(true);
    expect(draft!.status).toBe("PENDING_APPROVAL");
  });
});
