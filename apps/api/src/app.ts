import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { CATEGORIES, buildTree, findDuplicates, generateSample, SAMPLE_NOW, type DuplicateInfo, type FsNode, type Tree } from "@astrolabe/core";
import { LlmClassifier, LlmProvider, MockProvider, type AstraContext, type LlmClient, type Provider } from "@astrolabe/agents";

const ChatBody = z.object({
  text: z.string().min(1).max(2000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) })).max(40).default([]),
  selection: z.array(z.string().max(300)).max(5000).default([]),
});

const NodeSchema = z.object({
  id: z.string().max(300),
  sourceId: z.string().max(100),
  path: z.string().max(4000),
  name: z.string().max(1000),
  kind: z.enum(["folder", "file"]),
  size: z.number().nonnegative(),
  modifiedAt: z.number(),
  accessedAt: z.number(),
  parentId: z.string().max(300).nullable(),
  extraParentIds: z.array(z.string().max(300)).max(20).optional(),
  hash: z.string().max(200).optional(),
  ext: z.string().max(40).optional(),
  category: z.enum(CATEGORIES),
  categoryConfidence: z.number().optional(),
});
const TreeBody = z.object({ nodes: z.array(NodeSchema).min(1).max(600_000), now: z.number(), label: z.string().max(100) });

export interface AppOptions {
  /** Cliente LLM; sem ele a Astra usa o provedor simulado. */
  llm?: LlmClient;
  tree?: Tree;
  /** Máx. de mensagens por minuto por IP. */
  rateLimit?: number;
}

export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: 512 * 1024 });
  const sample = opts.tree ?? buildTree(generateSample());
  let current: { tree: Tree; dup: DuplicateInfo; now: number; label: string } = { tree: sample, dup: findDuplicates(sample), now: SAMPLE_NOW, label: "Amostra" };
  const provider: Provider = opts.llm ? new LlmProvider(opts.llm, new LlmClassifier(opts.llm)) : new MockProvider();
  const limit = opts.rateLimit ?? 30;
  const hits = new Map<string, { n: number; reset: number }>();

  // Só aceita pedidos vindos da própria máquina/origem local (a API mexe com arquivos).
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return reply.code(403).send({ error: "origem não permitida" });
    }
    reply.header("X-Content-Type-Options", "nosniff");
  });

  app.get("/api/health", async () => ({ ok: true, provider: opts.llm ? "anthropic" : "mock", nodes: current.tree.nodes.length, source: current.label }));

  // A interface envia o mapa da fonte ativa (disco, Drive) para a Astra enxergar o mesmo que o usuário.
  // Só metadados: nomes, caminhos, tamanhos e datas. Nunca o conteúdo dos arquivos.
  app.put("/api/tree", { bodyLimit: 256 * 1024 * 1024 }, async (req, reply) => {
    const p = TreeBody.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "mapa inválido" });
    try {
      const t = buildTree(p.data.nodes as FsNode[]);
      current = { tree: t, dup: findDuplicates(t), now: p.data.now, label: p.data.label };
    } catch {
      return reply.code(400).send({ error: "mapa inconsistente" });
    }
    return { ok: true, nodes: current.tree.nodes.length };
  });

  app.delete("/api/tree", async () => {
    current = { tree: sample, dup: findDuplicates(sample), now: SAMPLE_NOW, label: "Amostra" };
    return { ok: true };
  });

  app.post("/api/chat", async (req, reply) => {
    const now = Date.now();
    const h = hits.get(req.ip);
    if (!h || h.reset < now) hits.set(req.ip, { n: 1, reset: now + 60_000 });
    else if (++h.n > limit) return reply.code(429).send({ error: "muitas mensagens; espere um pouco" });

    const parsed = ChatBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "pedido inválido" });
    const { text, history, selection } = parsed.data;
    const ctx: AstraContext = { tree: current.tree, now: current.now, dup: current.dup, selection: selection.filter((id) => current.tree.index.has(id)), sourceLabel: current.label };

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    const send = (data: unknown) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    try {
      for await (const ev of provider.chat({ text, history, ctx })) send(ev);
    } catch (e) {
      send({ kind: "text", text: "Tive um problema para pensar nisso agora. Tente de novo em instantes." });
      app.log.error(e);
    }
    send({ kind: "done" });
    reply.raw.end();
    return reply;
  });

  return app;
}
