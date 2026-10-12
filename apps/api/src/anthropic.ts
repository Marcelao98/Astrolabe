import Anthropic from "@anthropic-ai/sdk";
import type { LlmBlock, LlmClient, LlmMessage, LlmToolSpec } from "@astrolabe/agents";

export const DEFAULT_MODEL = "claude-sonnet-5-5";

/** Adaptador mínimo entre o LlmClient da Astra e o SDK oficial da Anthropic. */
export class AnthropicClient implements LlmClient {
  private sdk: Anthropic;
  constructor(
    apiKey: string,
    private model = DEFAULT_MODEL,
  ) {
    this.sdk = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  }

  async complete(req: { system: string; messages: LlmMessage[]; tools?: LlmToolSpec[]; maxTokens: number }) {
    const res = await this.sdk.messages.create({
      model: this.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages as Anthropic.MessageParam[],
      tools: req.tools as Anthropic.Tool[] | undefined,
    });
    const content: LlmBlock[] = [];
    for (const b of res.content) {
      if (b.type === "text") content.push({ type: "text", text: b.text });
      else if (b.type === "tool_use") content.push({ type: "tool_use", id: b.id, name: b.name, input: b.input });
    }
    return { content, stopReason: res.stop_reason ?? "end_turn" };
  }
}
