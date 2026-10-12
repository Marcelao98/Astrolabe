import type { DuplicateInfo, NodeQuery, ScaleMode, Tree } from "@astrolabe/core";
import type { Plan } from "@astrolabe/actions";

export type AstraMood = "neutral" | "happy" | "search" | "alert" | "think";

export interface AstraContext {
  tree: Tree;
  now: number;
  dup: DuplicateInfo;
  /** Ids dos nós selecionados pelo usuário no mapa. */
  selection: string[];
  sourceLabel: string;
}

/** O que a Astra pede para a interface fazer. A interface decide se e como aplicar. */
export type AstraAction =
  | { type: "setLens"; lens: "type" | "age" | "size" | "duplicates" }
  | { type: "setScale"; mode: ScaleMode }
  | { type: "focus"; query: NodeQuery; label: string; count: number }
  | { type: "clearFocus" }
  | { type: "flyTo"; id: string }
  | { type: "select"; ids: string[] }
  | {
      type: "customLens";
      id: string;
      label: string;
      description: string;
      legend: string[];
      labels: { id: string; label: string; confidence: number }[];
    }
  | { type: "plan"; plan: Plan };

export type AstraEvent =
  | { kind: "text"; text: string }
  | { kind: "mood"; mood: AstraMood }
  | { kind: "action"; action: AstraAction }
  | { kind: "done" };

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export interface ChatInput {
  text: string;
  history: ChatMessage[];
  ctx: AstraContext;
}

export interface Provider {
  readonly name: string;
  chat(input: ChatInput): AsyncGenerator<AstraEvent>;
}

// ---- cliente LLM mínimo (o adaptador da Anthropic mora na API, para este pacote rodar no navegador) ----
export type LlmBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface LlmMessage {
  role: "user" | "assistant";
  content: string | LlmBlock[];
}

export interface LlmToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LlmClient {
  complete(req: {
    system: string;
    messages: LlmMessage[];
    tools?: LlmToolSpec[];
    maxTokens: number;
  }): Promise<{ content: LlmBlock[]; stopReason: string }>;
}
