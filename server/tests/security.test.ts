import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { agent, resetDb, makeStudent, login, loginAsAdmin, runDueJobs, prisma } from "./helpers.js";

describe("security & controls", () => {
  beforeEach(resetDb);

  it("19. a mutating request without a CSRF token is rejected", async () => {
    await makeStudent("c19@test.local", true);
    const a = agent();
    await login(a, "c19@test.local", "StudentPass1");
    const res = await a.post("/api/doubts").field("body", "no csrf"); // no X-CSRF-Token
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("csrf");
  });

  it("20. a non-image upload is rejected by magic-byte validation", async () => {
    await makeStudent("c20@test.local", true);
    const a = agent();
    const { csrf } = await login(a, "c20@test.local", "StudentPass1");
    const res = await a
      .post("/api/doubts")
      .set("X-CSRF-Token", csrf)
      .field("body", "fake image")
      .attach("image", Buffer.from("this is not an image"), "evil.png");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_image");
  });

  it("21. the WhatsApp webhook rejects a bad signature", async () => {
    const res = await agent().post("/api/webhooks/whatsapp").set("x-hub-signature-256", "sha256=deadbeef").send({ hi: 1 });
    expect(res.status).toBe(401);
  });

  it("webhook accepts a correctly-signed payload", async () => {
    const body = JSON.stringify({ entry: [] });
    const sig = "sha256=" + createHmac("sha256", "test-secret").update(Buffer.from(body)).digest("hex");
    const res = await agent()
      .post("/api/webhooks/whatsapp")
      .set("Content-Type", "application/json")
      .set("x-hub-signature-256", sig)
      .send(body);
    expect(res.status).toBe(200);
  });

  it("22. mode B reuses a strong approved-answer match (auto-send)", async () => {
    const admin = await loginAsAdmin();
    // Seed an approved answer (embedded via mock) matching the question text.
    await admin.a
      .post("/api/admin/approved-answers")
      .set("X-CSRF-Token", admin.csrf)
      .send({ question: "What is the capital of France?", answer: "The capital of France is Paris." });
    await admin.a.put("/api/admin/settings").set("X-CSRF-Token", admin.csrf).send({ replyMode: "B" });

    await makeStudent("c22@test.local", true);
    const a = agent();
    const { csrf } = await login(a, "c22@test.local", "StudentPass1");
    await a.post("/api/doubts").set("X-CSRF-Token", csrf).field("body", "What is the capital of France?");
    await runDueJobs();

    const draft = await prisma.responseDraft.findFirstOrThrow();
    // Strong approved match → eligible → auto-sent without a human decision.
    expect(draft.status).toBe("SENT");
    expect(draft.decidedById).toBeNull();
  });

  it("admin settings never leak secrets", async () => {
    const admin = await loginAsAdmin();
    const res = await admin.a.get("/api/admin/settings");
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/sk-|Bearer|SERVICE_KEY|password/i);
    expect(res.body.integrations).toBeDefined();
  });
});
