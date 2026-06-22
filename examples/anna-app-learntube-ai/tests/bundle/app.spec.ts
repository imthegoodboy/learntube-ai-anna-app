import { describe, expect, it } from "vitest";
import { mountBundle, HostApiError } from "@anna-ai/cli/test";
import manifest from "../../manifest.json" with { type: "json" };
import { spawnSync } from "node:child_process";
import path from "node:path";

const TOOL_ID = "tool-nikku696969-learntube-processor-adb7bdym";

function mocks() {
  const storage = new Map<string, any>();
  return {
    "tools.invoke": ({ tool_id, method, args }: any) => {
      if (tool_id !== TOOL_ID) return { success: false, error: { code: "unknown_tool" } };
      if (method === "process_videos") {
        return {
          success: true,
          data: {
            workspace: {
              id: "lt-test",
              title: "Binary Search Explained",
              sourceLabel: args?.urls?.[0] || "manual",
              topic: "DSA",
              subtopic: "Binary Search",
              difficulty: "Beginner",
              goal: args?.goal || "DSA interview readiness",
              summary: "Binary search halves a sorted search space.",
              prerequisites: ["Sorted arrays", "Loops"],
              transcriptSnippets: ["Binary search works on sorted arrays."],
              chapters: [{ time: "00:00", title: "Search space", note: "Start with the full array." }],
              detailedNotes: [{ heading: "Core idea", points: ["Use sorted order.", "Move boundaries."] }],
              flashcards: [{ id: "card-main", front: "What is it?", back: "A halving search." }],
              quiz: [{ id: "quiz-main", question: "Time complexity?", choices: ["O(n)", "O(log n)"], answerIndex: 1, concept: "Complexity", explanation: "Halving." }],
              actionItems: [{ id: "action-main", title: "Solve three prompts", reason: "Practice.", effort: "30 min" }],
              roadmap: [{ id: "node-arrays", title: "Arrays", note: "Base.", status: "done" }],
              weakConcepts: ["Boundary updates"],
              codeExample: "while left <= right: pass",
              nextRevisionLabel: "1 day",
              createdAt: "2026-06-22T00:00:00Z",
            },
          },
        };
      }
      if (method === "answer_question") {
        return { success: true, data: { answer: "Use the lesson evidence only." } };
      }
      return { success: false, error: { code: "unknown_method" } };
    },
    "storage.get": ({ key }: any) => ({ value: storage.get(key) ?? null }),
    "storage.set": ({ key, value }: any) => {
      storage.set(key, value);
      return { ok: true };
    },
    "storage.list": () => ({ keys: Array.from(storage.keys()) }),
    "storage.delete": ({ key }: any) => {
      storage.delete(key);
      return { ok: true };
    },
    "llm.complete": () => ({
      role: "assistant",
      content: {
        type: "text",
        text: "{\"summary\":\"Binary search halves sorted ranges.\",\"weakConcepts\":[\"Boundary updates\"]}",
      },
    }),
    "chat.write_message": () => ({ ok: true }),
    "window.set_title": () => ({ ok: true }),
  };
}

describe("learntube-ai bundle contract", () => {
  it("allows declared Anna APIs and blocks undeclared fs", async () => {
    const harness = await mountBundle({ manifest: manifest as any, mocks: mocks() });
    await harness.runtime.storage.set({ key: "learntube-ai:test", value: { ok: true } });
    expect(harness.calls.lastOf("storage.set")?.outcome).toBe("ok");
    await harness.runtime.storage.get({ key: "learntube-ai:test" });
    expect(harness.calls.lastOf("storage.get")?.outcome).toBe("ok");
    const llm = await harness.runtime.llm.complete({
      messages: [{ role: "user", content: { type: "text", text: "Summarize binary search." } }],
      maxTokens: 64,
    });
    expect((llm as any).content.text).toBeTruthy();

    await expect(
      harness.runtime.call("fs", "read", { path: "/etc/passwd" }),
    ).rejects.toBeInstanceOf(HostApiError);
    expect(harness.calls.last()?.outcome).toBe("denied");
  });

  it("processor Executa returns a full workspace over stdio", () => {
    const plugin = path.resolve("executas", "learntube-processor", "learntube_processor.py");
    const req = {
      jsonrpc: "2.0",
      id: 1,
      method: "invoke",
      params: {
        tool: "process_videos",
        arguments: {
          urls: ["https://www.youtube.com/watch?v=binary-search-demo"],
          manual_transcript: "Binary search works on sorted arrays and halves the search space.",
          goal: "DSA interview readiness",
          days: 30,
        },
      },
    };
    const result = spawnSync("python", [plugin], {
      input: `${JSON.stringify(req)}\n`,
      encoding: "utf8",
      cwd: path.resolve("."),
    });
    expect(result.status).toBe(0);
    const line = result.stdout.trim().split(/\r?\n/).at(-1);
    expect(line).toBeTruthy();
    const parsed = JSON.parse(line!);
    expect(parsed.result.success).toBe(true);
    expect(parsed.result.data.workspace.subtopic).toBe("Binary Search");
    expect(parsed.result.data.workspace.flashcards.length).toBeGreaterThan(1);
  });
});
