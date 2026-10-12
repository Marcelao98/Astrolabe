import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";

const parse = (body: string) =>
  body.split("\n\n").filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, "")) as { kind: string; text?: string; action?: { type: string } });

describe("API da Astra", () => {
  const app = buildApp({ rateLimit: 3 });

  it("health informa o provedor", async () => {
    const r = await app.inject({ method: "GET", url: "/api/health" });
    expect(r.json()).toMatchObject({ ok: true, provider: "mock" });
  });

  it("chat devolve eventos SSE e termina com done", async () => {
    const r = await app.inject({ method: "POST", url: "/api/chat", payload: { text: "mostra meus vídeos" } });
    expect(r.headers["content-type"]).toContain("text/event-stream");
    const ev = parse(r.body);
    expect(ev.some((e) => e.kind === "action" && e.action?.type === "focus")).toBe(true);
    expect(ev.at(-1)?.kind).toBe("done");
  });

  it("valida a entrada, ignora ids inventados, limita taxa e rejeita origem externa", async () => {
    expect((await app.inject({ method: "POST", url: "/api/chat", payload: { text: "" } })).statusCode).toBe(400);
    const r = await app.inject({ method: "POST", url: "/api/chat", payload: { text: "oi", selection: ["../../etc/passwd"] } });
    expect(r.statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/chat", payload: { text: "oi" } })).statusCode).toBe(429);
    const bad = await app.inject({ method: "GET", url: "/api/health", headers: { origin: "https://evil.example" } });
    expect(bad.statusCode).toBe(403);
  });

  it("a Astra passa a enxergar o mapa enviado pela interface", async () => {
    const a = buildApp();
    const t = 1_700_000_000_000;
    const base = { sourceId: "local", modifiedAt: t, accessedAt: t, category: "other" as const, extraParentIds: undefined };
    const nodes = [
      { ...base, id: "r", path: "D:", name: "D:", kind: "folder", size: 0, parentId: null },
      { ...base, id: "f", path: "D:/filme.mp4", name: "filme.mp4", kind: "file", size: 5e9, parentId: "r", ext: "mp4", category: "video" },
    ];
    const put = await a.inject({ method: "PUT", url: "/api/tree", payload: { nodes, now: t, label: "D:" } });
    expect(put.json()).toMatchObject({ ok: true, nodes: 2 });
    expect((await a.inject({ method: "GET", url: "/api/health" })).json()).toMatchObject({ source: "D:" });
    const r = await a.inject({ method: "POST", url: "/api/chat", payload: { text: "mostra meus vídeos" } });
    expect(r.body).toContain("filme.mp4");
    expect((await a.inject({ method: "PUT", url: "/api/tree", payload: { nodes: [{ id: 1 }], now: 1, label: "x" } })).statusCode).toBe(400);
  });
});
