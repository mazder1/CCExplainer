// One shared door to ANY language-model provider.
//
// Nearly every provider speaks the same "chat completions" dialect that
// OpenAI made standard — Kimi (Moonshot), DeepSeek, Groq, Mistral, local
// models via Ollama, and Anthropic's compatibility endpoint included. So
// switching providers is not code, it is configuration: three values in .env.
//
//   LLM_BASE_URL  which kitchen   (default: https://api.openai.com/v1)
//   LLM_API_KEY   whose account   (falls back to OPENAI_API_KEY)
//   LLM_MODEL     which cook      (default: gpt-5-mini)
//
// See .env.example for ready-made recipes per provider.

export function llmConfig() {
  const baseUrl = (process.env.LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const apiKey = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
  const model = process.env.LLM_MODEL ?? "gpt-5-mini";
  return { baseUrl, apiKey, model };
}

export async function chat(messages, { model } = {}) {
  const cfg = llmConfig();
  if (!cfg.apiKey) {
    throw new Error(
      "No language-model API key found. Set OPENAI_API_KEY in .env — or, for " +
        "another provider, set LLM_BASE_URL + LLM_API_KEY + LLM_MODEL (see .env.example).",
    );
  }
  const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: model ?? cfg.model, messages }),
  });
  if (!response.ok) {
    throw new Error(
      `${new URL(cfg.baseUrl).host} answered ${response.status} ${response.statusText}:\n${await response.text()}`,
    );
  }
  const data = await response.json();
  return { text: data.choices[0].message.content.trim(), usage: data.usage };
}
