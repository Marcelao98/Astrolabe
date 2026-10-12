import { useState } from "react";
import type { FsNode } from "@astrolabe/core";
import { AgentConnection, type Runner } from "../astra/agent";
import { GOOGLE_CLIENT_ID, connectDrive } from "../astra/drive";

interface Props {
  onClose(): void;
  onLoaded(runner: Runner, label: string, nodes: FsNode[], note: string): void;
}

export function ConnectDialog({ onClose, onLoaded }: Props) {
  const [url, setUrl] = useState("http://127.0.0.1:8788");
  const [token, setToken] = useState("");
  const [roots, setRoots] = useState<string[] | null>(null);
  const [root, setRoot] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const [tab, setTab] = useState<"pc" | "drive">("pc");
  const [allow, setAllow] = useState(false);

  const drive = async () => {
    setBusy(true);
    setMsg("Entrando no Google e lendo o seu Drive…");
    try {
      const { scan, runner } = await connectDrive(allow);
      const note = `${scan.nodes.length.toLocaleString("pt-BR")} itens${scan.truncated ? " (limite atingido)" : ""}`;
      onLoaded(runner, "Google Drive", scan.nodes, note);
    } catch (e) {
      setMsg((e as Error).message);
      setBusy(false);
    }
  };

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

  const scanPc = async () => {
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
        <div className="group" role="tablist">
          <button className={`chip ${tab === "pc" ? "on" : ""}`} onClick={() => setTab("pc")}>Meu PC / HD externo</button>
          <button className={`chip ${tab === "drive" ? "on" : ""}`} onClick={() => setTab("drive")}>Google Drive</button>
        </div>
        {tab === "drive" ? (
          <>
            <p className="plan-sum">
              Entre com a sua conta Google. A Astra lê só nomes, tamanhos e datas — nunca o conteúdo dos arquivos. {GOOGLE_CLIENT_ID ? "" : "Falta configurar VITE_GOOGLE_CLIENT_ID (veja o README)."}
            </p>
            <label className="field check">
              <span><input type="checkbox" checked={allow} onChange={(e) => setAllow(e.target.checked)} /> Permitir que eu aprove mudanças (mover/lixeira do Drive)</span>
            </label>
            <div className="plan-actions"><button className="go" disabled={busy || !GOOGLE_CLIENT_ID} onClick={() => void drive()}>Entrar com o Google</button></div>
          </>
        ) : (<>
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
            <div className="plan-actions"><button className="go" disabled={busy} onClick={() => void scanPc()}>Escanear e abrir a galáxia</button></div>
          </>
        )}
        </>)}
        {msg && <p className="plan-warn">{msg}</p>}
      </div>
    </div>
  );
}
