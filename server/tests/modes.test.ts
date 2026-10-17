import { describe, it, expect, beforeEach } from "vitest";
import { agent, resetDb, makeStudent, login, loginAsAdmin, runDueJobs, prisma } from "./helpers.js";

const DOC = "Compound interest is interest calculated on the principal and also on the accumulated interest. The principal grows faster than with simple interest.";

async function uploadCourseDoc(admin: Awaited<ReturnType<typeof loginAsAdmin>>) {
  await admin.a.post("/api/admin/documents").set("X-CSRF-Token", admin.csrf).field("title", "Finance").attach("file", Buffer.from(DOC, "utf8"), "finance.txt");
  await runDueJobs(); // processDocument
}

async function askAs(email: string, body: string) {
  await makeStudent(email, true);
  const a = agent();
  const { csrf } = await login(a, email, "StudentPass1");
  await a.post("/api/doubts").set("X-CSRF-Token", csrf).field("body", body);
  await runDueJobs();
}

describe("reply modes & auto-reply controls", () => {
  beforeEach(resetDb);

  it("14. mode A (default) never auto-sends", async () => {
    await askAs("m14@test.local", "What is compound interest?");
    const draft = await prisma.responseDraft.findFirstOrThrow();
    expect(draft.status).toBe("PENDING_APPROVAL");
  });

  it("15. mode C auto-sends an eligible, course-backed answer", async () => {
    const admin = await loginAsAdmin();
    await uploadCourseDoc(admin);
    const ready = await prisma.courseDocument.findFirstOrThrow();
    expect(ready.status).toBe("READY");
    await admin.a.put("/api/admin/settings").set("X-CSRF-Token", admin.csrf).send({ replyMode: "C" });

    await askAs("m15@test.local", "Explain compound interest and how the principal grows");
    const draft = await prisma.responseDraft.findFirstOrThrow();
    expect(draft.evidenceSufficient).toBe(true);
    expect(draft.autoEligible).toBe(true);
    expect(draft.status).toBe("SENT"); // auto-sent, no human
    expect(draft.decidedById).toBeNull();
    const tutor = await prisma.doubtMessage.count({ where: { sender: "TUTOR" } });
    expect(tutor).toBe(1);
  });

  it("16. emergency pause blocks auto-reply in mode C", async () => {
    const admin = await loginAsAdmin();
    await uploadCourseDoc(admin);
    await admin.a.put("/api/admin/settings").set("X-CSRF-Token", admin.csrf).send({ replyMode: "C" });
    await admin.a.post("/api/admin/settings/pause").set("X-CSRF-Token", admin.csrf).send({ paused: true });

    await askAs("m16@test.local", "Explain compound interest and the principal");
    const draft = await prisma.responseDraft.findFirstOrThrow();
    expect(draft.status).toBe("PENDING_APPROVAL"); // held for a human
    const tutor = await prisma.doubtMessage.count({ where: { sender: "TUTOR" } });
    expect(tutor).toBe(0);
  });
});
