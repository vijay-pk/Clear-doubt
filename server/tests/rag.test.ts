import { describe, it, expect, beforeEach } from "vitest";
import { agent, resetDb, makeStudent, login, loginAsAdmin, runDueJobs, prisma } from "./helpers.js";
import { searchCourse } from "../src/retrieval/courseSearch.js";

const DOC = "Photosynthesis is the process by which green plants convert sunlight, water, and carbon dioxide into glucose and oxygen using chlorophyll.";

describe("course knowledge (RAG)", () => {
  beforeEach(resetDb);

  it("17. uploaded transcript is extracted, chunked, embedded and searchable", async () => {
    const admin = await loginAsAdmin();
    const up = await admin.a
      .post("/api/admin/documents")
      .set("X-CSRF-Token", admin.csrf)
      .field("title", "Biology")
      .attach("file", Buffer.from(DOC, "utf8"), "bio.txt");
    expect(up.status).toBe(201);
    await runDueJobs();

    const doc = await prisma.courseDocument.findFirstOrThrow();
    expect(doc.status).toBe("READY");
    const chunks = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*)::bigint AS n FROM "DocumentChunk"`);
    expect(Number(chunks[0]!.n)).toBeGreaterThan(0);

    const hits = await searchCourse("photosynthesis glucose", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.content.toLowerCase()).toContain("photosynthesis");
  });

  it("18. a course-backed answer is flagged evidenceSufficient with citations", async () => {
    const admin = await loginAsAdmin();
    await admin.a.post("/api/admin/documents").set("X-CSRF-Token", admin.csrf).field("title", "Bio").attach("file", Buffer.from(DOC, "utf8"), "bio.txt");
    await runDueJobs();

    await makeStudent("r18@test.local", true);
    const a = agent();
    const { csrf } = await login(a, "r18@test.local", "StudentPass1");
    await a.post("/api/doubts").set("X-CSRF-Token", csrf).field("body", "How does photosynthesis produce glucose?");
    await runDueJobs();

    const draft = await prisma.responseDraft.findFirstOrThrow();
    expect(draft.evidenceSufficient).toBe(true);
    const citations = await prisma.citation.count({ where: { draftId: draft.id } });
    expect(citations).toBeGreaterThan(0);
  });
});
