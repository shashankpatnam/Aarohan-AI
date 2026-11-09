import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { APPROVED_FACT_PROJECT_NAMES } from "../config/projectFacts.js";
import ProjectFacts from "../models/ProjectFacts.js";
import {
  buildGeminiOutageHandoffTurn,
  generateLeadChatTurn,
} from "../services/geminiLeadChat.js";
import { CHAT_FAILURE_REASON } from "../services/leadChatGracefulFallback.js";
import { resolveLeadChatTurn } from "../services/leadChatTurnResolver.js";
import { startTestMongo, stopTestMongo } from "./helpers/testMongo.js";

let memoryServer;
const originalGeminiApiKey = process.env.GEMINI_API_KEY;

function modelResult(reply) {
  return {
    outcome: "success",
    result: {
      response: {
        text: () =>
          JSON.stringify({
            reply,
            needsHumanHandoff: false,
            recommendQualified: false,
          }),
        candidates: [{ finishReason: "STOP" }],
      },
    },
  };
}

async function generateWithMock(input, outcome) {
  let prompt = "";
  const result = await generateLeadChatTurn({
    ...input,
    _geminiRetryDeps: {
      capturePrompt: (value) => {
        prompt = value;
      },
      executeWithPrimaryAndFallback: async () => outcome,
    },
  });
  return { result, prompt };
}

describe("portfolio-wide Gemini guest chat", () => {
  before(async () => {
    memoryServer = await startTestMongo();
    process.env.GEMINI_API_KEY = "portfolio-chat-test-key";
    const configs = [
      ["2 BHK", "3 BHK"],
      ["2 BHK", "3 BHK"],
      ["3 BHK"],
      ["3 BHK villa", "4 BHK villa"],
      ["2 BHK", "3 BHK"],
      ["DRAFT ONLY 1 BHK"],
    ];
    await ProjectFacts.collection.insertMany(
      APPROVED_FACT_PROJECT_NAMES.map((projectName, index) => ({
        projectName,
        approvalStatus: index === 5 ? "draft" : "approved",
        location: `${projectName} approved location`,
        propertyConfigurations: configs[index],
        amenities: index === 0 ? ["Swimming pool"] : ["Garden"],
        possessionTimeline: null,
        reraInformation: null,
        visitProcess: null,
        priceInformation: null,
        inventoryInformation: null,
        privateSalesNote: "internal only; never send to Gemini",
      })),
    );
  });

  after(async () => {
    await stopTestMongo(memoryServer);
    if (originalGeminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiApiKey;
    }
  });

  it("sends all six projects to General Chat with a null initial project", async () => {
    const { result, prompt } = await generateWithMock(
      {
        initialProject: null,
        latestBuyerMessage: "What 2 BHK projects do you have?",
      },
      modelResult(
        "Skyline Residences, Green Valley Phase 2, and Orchid Park Residences list 2 BHK configurations in the approved facts.",
      ),
    );

    assert.equal(result.ok, true);
    assert.match(prompt, /"initialProject": null/);
    const factsJson = prompt
      .split("=== APPROVED PORTFOLIO FACTS (only source for property claims) ===\n")[1]
      .split("\n\n=== LEAD CONTEXT")[0];
    const portfolio = JSON.parse(factsJson);
    assert.deepEqual(
      portfolio.projects.map(({ projectName }) => projectName),
      [...APPROVED_FACT_PROJECT_NAMES],
    );
    assert.equal(portfolio.projects[5].facts, null);
    assert.equal(factsJson.includes("DRAFT ONLY 1 BHK"), false);
    assert.equal(factsJson.includes("internal only"), false);
    assert.equal(result.data.reply.includes("2 BHK"), true);
  });

  it("preserves project context, history, summary and qualification for comparisons", async () => {
    const { result, prompt } = await generateWithMock(
      {
        initialProject: "Palm Grove Villas",
        latestBuyerMessage: "Compare Skyline Residences and Orchid Park Residences.",
        recentMessages: [
          { from: "buyer", text: "I started by asking about Palm Grove Villas." },
          { from: "ai", text: "What configuration are you considering?" },
        ],
        leadContext: {
          buyerSummary: "Started with Palm Grove Villas; looking for 2 BHK.",
          preferredLanguage: "English",
          qualification: {
            buyingTimeline: "6 months",
            budgetFit: "within stated range",
            locationPreference: "Ahmedabad",
          },
        },
      },
      modelResult(
        "Skyline Residences and Orchid Park Residences list 2 BHK configurations. Palm Grove Villas lists 3 BHK and 4 BHK villas.",
      ),
    );

    assert.equal(result.ok, true);
    assert.match(prompt, /"initialProject": "Palm Grove Villas"/);
    assert.match(prompt, /Started with Palm Grove Villas; looking for 2 BHK/);
    assert.match(prompt, /"buyingTimeline": "6 months"/);
    assert.match(prompt, /Buyer: I started by asking about Palm Grove Villas/);
    assert.match(prompt, /Orchid Park Residences/);
    assert.match(prompt, /"propertyConfigurations": \[\n\s+"3 BHK villa"/);
  });

  it("replaces an unsupported claim for a project with no approved facts", async () => {
    const { result } = await generateWithMock(
      {
        initialProject: null,
        latestBuyerMessage: "Does Terrace Gardens have a pool?",
      },
      modelResult("Terrace Gardens includes a swimming pool."),
    );

    assert.equal(result.ok, true);
    assert.match(result.data.reply, /don't have verified/i);
    assert.match(result.data.reply, /Terrace Gardens/);
    assert.equal(result.data.needsHumanHandoff, true);
    assert.ok(result.data.handoffReason);
  });

  it("keeps API outage errors independent of whether there is initial project context", async () => {
    for (const initialProject of [null, "Palm Grove Villas"]) {
      const input = {
        initialProject,
        latestBuyerMessage: "Compare some options.",
      };
      const { result } = await generateWithMock(
        input,
        { outcome: "retries_exhausted", modelName: "mock-model" },
      );
      assert.equal(result.ok, false);
      assert.match(
        buildGeminiOutageHandoffTurn(initialProject).reply,
        initialProject ? /Palm Grove Villas/ : /our Aarohan property portfolio/,
      );
      const resolved = await resolveLeadChatTurn(
        {
          ...input,
          recentMessages: [],
          leadContext: {},
          lead: {
            project: initialProject,
            preferredLanguage: "",
            buyerSummary: "",
          },
        },
        async () => result,
      );
      assert.equal(
        resolved.chatFailureReason,
        CHAT_FAILURE_REASON.MODEL_UNAVAILABLE,
      );
      assert.equal(resolved.data.needsHumanHandoff, true);
      assert.doesNotMatch(resolved.data.handoffReason, /undefined|null/);
    }
  });
});
