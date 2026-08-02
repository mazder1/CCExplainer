import test from "node:test";
import assert from "node:assert/strict";
import { llmConfig, chat } from "../scripts/lib/llm.mjs";

// These tests never touch the network: fetch is replaced with a fake, and
// provider selection is driven purely through environment variables.

const ENV_KEYS = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "OPENAI_API_KEY"];
const savedEnv = {};
for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
const savedFetch = globalThis.fetch;

function setEnv(vars) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, vars);
}

test.after(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  globalThis.fetch = savedFetch;
});

test("llmConfig defaults to OpenAI with the OPENAI_API_KEY fallback", () => {
  setEnv({ OPENAI_API_KEY: "sk-test" });
  const cfg = llmConfig();
  assert.equal(cfg.baseUrl, "https://api.openai.com/v1");
  assert.equal(cfg.apiKey, "sk-test");
  assert.equal(cfg.model, "gpt-5-mini");
});

test("llmConfig honors LLM_* overrides and trims trailing slashes", () => {
  setEnv({
    OPENAI_API_KEY: "sk-ignored",
    LLM_BASE_URL: "https://api.moonshot.ai/v1/",
    LLM_API_KEY: "kimi-key",
    LLM_MODEL: "kimi-k2",
  });
  const cfg = llmConfig();
  assert.equal(cfg.baseUrl, "https://api.moonshot.ai/v1");
  assert.equal(cfg.apiKey, "kimi-key");
  assert.equal(cfg.model, "kimi-k2");
});

test("chat refuses to run without any API key", async () => {
  setEnv({});
  await assert.rejects(() => chat([{ role: "user", content: "hi" }]), /No language-model API key/);
});

test("chat sends the standard request shape and returns trimmed text + usage", async () => {
  setEnv({ OPENAI_API_KEY: "sk-test" });
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "  the answer  " } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    };
  };

  const messages = [
    { role: "system", content: "be brief" },
    { role: "user", content: "hi" },
  ];
  const result = await chat(messages, { model: "gpt-5-mini" });

  assert.equal(result.text, "the answer");
  assert.equal(result.usage.prompt_tokens, 10);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(calls[0].opts.headers.Authorization, "Bearer sk-test");
  assert.deepEqual(JSON.parse(calls[0].opts.body), { model: "gpt-5-mini", messages });
});

test("chat surfaces provider errors with host and status", async () => {
  setEnv({ OPENAI_API_KEY: "sk-bad" });
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    statusText: "Unauthorized",
    text: async () => "invalid key",
  });
  await assert.rejects(() => chat([{ role: "user", content: "hi" }]), /api\.openai\.com answered 401/);
});
