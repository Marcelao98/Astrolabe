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
});
