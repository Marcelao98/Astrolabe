import { useEffect, useMemo, useRef, useState } from "react";
import type { AstraAction, AstraContext, ChatMessage } from "@astrolabe/agents";
import { AstraAvatar, type AstraMood } from "./AstraAvatar";
import { AstraClient } from "../astra/client";

interface Props {
  getContext(): AstraContext;
  onAction(action: AstraAction): void;
}

const SUGGESTIONS = ["O que está ocupando mais espaço?", "Mostra meus vídeos", "O que está parado há mais de 2 anos?", "Limpa os duplicados"];

export function AstraDock({ getContext, onAction }: Props) {
  const client = useMemo(() => new AstraClient(), []);
  const [open, setOpen] = useState(true);
  const [mood, setMood] = useState<AstraMood>("happy");
  const [msgs, setMsgs] = useState<ChatMessage[]>([
    { role: "assistant", text: "Oi! Eu sou a Astra. Pergunte o que quiser sobre o seu armazenamento — eu mostro no mapa e, se você pedir, preparo uma limpeza para você aprovar." },
  ]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<string>("");
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void client.mode().then(setMode);
  }, [client]);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  const send = async (raw: string) => {
    const q = raw.trim();
    if (!q || busy) return;
    setText("");
    setBusy(true);
    const history = msgs.slice(1);
    setMsgs((m) => [...m, { role: "user", text: q }]);
    try {
      for await (const ev of client.chat(q, history, getContext())) {
        if (ev.kind === "text") setMsgs((m) => [...m, { role: "assistant", text: ev.text }]);
        else if (ev.kind === "mood") setMood(ev.mood);
        else if (ev.kind === "action") onAction(ev.action);
      }
    } catch {
      setMsgs((m) => [...m, { role: "assistant", text: "Ops, algo deu errado aqui. Tenta de novo?" }]);
    } finally {
      setBusy(false);
      setTimeout(() => setMood("happy"), 1800);
    }
  };

  return (
    <div className="astra-dock">
      {open && (
        <div className="astra-chat glass" role="dialog" aria-label="Conversa com a Astra">
          <div className="astra-chat-head">
            <b>Astra</b>
            <small>{mode ? `modo ${mode}` : ""}</small>
            <button className="x" onClick={() => setOpen(false)} aria-label="Minimizar">–</button>
          </div>
          <div className="astra-log" ref={log} aria-live="polite">
            {msgs.map((m, k) => (
              <p key={k} className={`msg ${m.role}`}>{m.text}</p>
            ))}
            {busy && <p className="msg assistant typing"><i /><i /><i /></p>}
          </div>
          {msgs.length < 3 && (
            <div className="astra-sugg">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => void send(s)}>{s}</button>
              ))}
            </div>
          )}
          <form
            className="astra-input"
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
          >
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Fale com a Astra…" maxLength={2000} aria-label="Mensagem para a Astra" />
            <button disabled={busy || !text.trim()}>Enviar</button>
          </form>
        </div>
      )}
      <button className="astra-btn" onClick={() => setOpen((o) => !o)} aria-label={open ? "Minimizar a Astra" : "Abrir a Astra"}>
        <AstraAvatar mood={busy ? "think" : mood} size={open ? 112 : 132} />
      </button>
    </div>
  );
}
