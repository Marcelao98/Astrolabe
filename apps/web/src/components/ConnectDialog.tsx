import { useState } from "react";
import type { FsNode } from "@astrolabe/core";
import { AgentConnection } from "../astra/agent";

interface Props {
  onClose(): void;
  onLoaded(conn: AgentConnection, root: string, nodes: FsNode[], note: string): void;
}

export function ConnectDialog({ onClose, onLoaded }: Props) {
  const [url, setUrl] = useState("http://127.0.0.1:8788");
  const [token, setToken] = useState("");
  const [roots, setRoots] = useState<string[] | null>(null);
  const [root, setRoot] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const conn = () => new AgentConnection(url.replace(/\/$/, ""), token.trim());

  const connect = async () => {
    setBusy(true);
    setMsg("");
    try {
      const info = await conn().info();
      setRoots(info.roots);
      setRoot(info.roots[0] ?? "");
    } catch (e) {
      setMsg(e instanceof TypeError ? "Não encontrei o agente. Ele está rodando no seu PC?" : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const scan = async () => {
    setBusy(true);
    setMsg("Escaneando… discos grandes podem levar alguns minutos.");
    try {
      const c = conn();
      const r = await c.scan(root);
      const note = `${r.nodes.length.toLocaleString("pt-BR")} itens${r.truncated ? " (limite atingido; escolha uma pasta menor)" : ""}${r.errors ? ` · ${r.errors} sem acesso` : ""}`;
      onLoaded(c, root, r.nodes, note);
    } catch (e) {
      setMsg((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal glass" role="dialog" aria-label="Conectar ao seu computador" onClick={(e) => e.stopPropagation()}>
        <div className="plan-head">
          <b>Conectar ao seu computador</b>
          <button className="x" onClick={onClose} aria-label="Fechar">✕</button>
        </div>
        <p className="plan-sum">
          Rode o agente no seu PC: <code>pnpm dev:agent D:\</code>. Ele mostra um token; cole abaixo. O agente só mexe nas pastas que você liberou lá.
        </p>
        <label className="field">Endereço do agente<input value={url} onChange={(e) => setUrl(e.target.value)} /></label>
        {!roots ? (
          <>
            <label className="field">Token<input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" /></label>
            <div className="plan-actions"><button className="go" disabled={busy || !token.trim()} onClick={() => void connect()}>Conectar</button></div>
          </>
        ) : (
          <>
            <label className="field">Pasta ou disco
              <select value={root} onChange={(e) => setRoot(e.target.value)}>{roots.map((r) => <option key={r}>{r}</option>)}</select>
            </label>
            <div className="plan-actions"><button className="go" disabled={busy} onClick={() => void scan()}>Escanear e abrir a galáxia</button></div>
          </>
        )}
        {msg && <p className="plan-warn">{msg}</p>}
      </div>
    </div>
  );
}
