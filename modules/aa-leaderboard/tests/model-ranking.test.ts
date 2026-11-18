import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb } from "@aihot/backend/db";
import { loadModelRankings, syncModelRankings } from "../server.ts";

after(closeDb);

function page(number: number, total: number, data: unknown[], version = 5.1) {
  return Response.json({
    intelligence_index_version: version,
    pagination: { page: number, total_pages: total, has_more: number < total },
    data,
  });
}

const openAiCreator = "e67e56e3-15cd-43db-b679-da4660a69f41";

function model(id: string, name: string, score: unknown, creatorId?: string) {
  return { id, name, evaluations: { artificial_analysis_intelligence_index: score }, model_creator: creatorId ? { id: creatorId } : undefined };
}

test("publishes all scored tiers once and keeps the successful snapshot if another run fails", async (t) => {
  const key = "aa-test-key";
  process.env.AA_API_KEY = key;
  t.after(() => { delete process.env.AA_API_KEY; });

  assert.deepEqual(await loadModelRankings(), { items: [], updatedAt: null });
  const fetchMock = t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get("x-api-key"), key);
    assert.equal(init.method, "GET");
    const requested = new URL(url);
    assert.equal(requested.origin + requested.pathname, "https://artificialanalysis.ai/api/v2/language/models/free");
    if (requested.search === "?page=1") {
      return page(1, 2, [
        model("a-low", "Model A (Low)", 55.001, openAiCreator),
        model("a-high", "Model A (High)", 55.002, openAiCreator),
        model("invalid-null", "Unscored", null),
        model("invalid-string", "Text score", "99"),
        model("zero", "Zero score", 0),
      ]);
    }
    assert.equal(requested.search, "?page=2");
    return page(2, 2, [
      model("a-high", "Model A (High)", 55.002),
      model("b", "Model B (Thinking)", 55.0015, "unknown-creator"),
    ]);
  });

  assert.deepEqual(await syncModelRankings(), { pages: 2, models: 4 });
  assert.equal(fetchMock.mock.callCount(), 2);
  const saved = await loadModelRankings();
  assert.ok(saved.updatedAt && Number.isFinite(Date.parse(saved.updatedAt)));
  assert.deepEqual(saved.items, [
    { id: "a-high", name: "Model A (High)", score: 55.002, indexVersion: "5.1", icon: "/model-logos/openai.svg" },
    { id: "b", name: "Model B (Thinking)", score: 55.0015, indexVersion: "5.1", icon: null },
    { id: "a-low", name: "Model A (Low)", score: 55.001, indexVersion: "5.1", icon: "/model-logos/openai.svg" },
    { id: "zero", name: "Zero score", score: 0, indexVersion: "5.1", icon: null },
  ]);

  fetchMock.mock.mockImplementation(async (url: string) => new URL(url).search === "?page=1"
    ? page(1, 2, [model("c", "Model C", 90)])
    : new Response(null, { status: 503 }));
  await assert.rejects(syncModelRankings(), /page 2: HTTP 503/);
  assert.deepEqual(await loadModelRankings(), saved);

  fetchMock.mock.mockImplementation(async (url: string) => new URL(url).search === "?page=1"
    ? page(1, 2, [model("c", "Model C", 90)])
    : page(2, 2, [model("d", "Model D", 91)], 6));
  await assert.rejects(syncModelRankings(), /page 2: pagination or index version changed/);
  assert.deepEqual(await loadModelRankings(), saved);
});
