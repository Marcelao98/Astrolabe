import { useMemo, useState } from "react";
import type { ExecutionLog, Plan } from "@astrolabe/actions";
import { formatBytes } from "@astrolabe/core";

export type PlanPhase = "review" | "running" | "done";

interface Props {
  plan: Plan;
  demo: boolean;
  phase: PlanPhase;
  log: ExecutionLog | null;
  onPreview(actionIds: string[]): void;
  onApprove(actionIds: string[]): void;
  onUndo(): void;
  onClose(): void;
}

const KIND_LABEL = { move: "Mover", quarantine: "Quarentena", trash: "Lixeira" } as const;

/** Revisão do plano da Astra: nada acontece sem este botão de aprovação. */
export function PlanCard({ plan, demo, phase, log, onPreview, onApprove, onUndo, onClose }: Props) {
  const [off, setOff] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  const chosen = useMemo(() => plan.actions.filter((a) => !off.has(a.id)), [plan, off]);
  const bytes = chosen.reduce((s, a) => s + a.bytes, 0);
  const shown = all ? plan.actions : plan.actions.slice(0, 8);
  const done = log ? log.results.filter((r) => r.status === "done" && !log.undone.includes(r.actionId)).length : 0;
  const failed = log ? log.results.filter((r) => r.status === "failed") : [];
  const reverted = log ? log.undone.length : 0;
  const hasTrash = plan.actions.some((a) => a.kind === "trash");

  const toggle = (id: string) =>
    setOff((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  return (
    <div className="plan glass" role="dialog" aria-label="Plano proposto pela Astra">
      <div className="plan-head">
        <b>{plan.title}</b>
        <button className="x" onClick={onClose} aria-label="Fechar">✕</button>
      </div>
      <p className="plan-sum">{plan.summary}</p>
      {plan.warnings.map((w, k) => (
        <p key={k} className="plan-warn">⚠ {w}</p>
      ))}

      {phase === "review" && (
        <>
          <ul className="plan-list">
            {shown.map((a) => (
              <li key={a.id} className={off.has(a.id) ? "off" : ""}>
                <label>
                  <input type="checkbox" checked={!off.has(a.id)} onChange={() => toggle(a.id)} />
                  <span className={`kind ${a.kind}`}>{KIND_LABEL[a.kind]}</span>
                  <span className="from" title={a.from}>{a.from.split("/").slice(-2).join("/")}</span>
                  {a.to && <span className="to" title={a.to}>→ {a.to.split("/").slice(-2).join("/")}</span>}
                  <span className="val">{formatBytes(a.bytes)}</span>
                </label>
              </li>
            ))}
          </ul>
          {plan.actions.length > 8 && (
            <button className="link" onClick={() => setAll((v) => !v)}>
              {all ? "mostrar menos" : `mostrar os ${plan.actions.length - 8} restantes`}
            </button>
          )}
          <p className="plan-note">
            {hasTrash ? "Itens na lixeira podem ser restaurados pela lixeira do sistema. " : "Nada é apagado de verdade: vai para a quarentena e dá para desfazer. "}
            {demo ? "Modo demonstração: só a amostra muda." : "Isto muda os seus arquivos de verdade."}
          </p>
          <div className="plan-actions">
            <button onClick={() => onPreview(chosen.map((a) => a.id))}>Ver no mapa</button>
            <button className="go" disabled={chosen.length === 0} onClick={() => onApprove(chosen.map((a) => a.id))}>
              Aprovar {chosen.length} · {formatBytes(bytes)}
            </button>
          </div>
        </>
      )}

      {phase === "running" && <p className="plan-sum">Executando…</p>}

      {phase === "done" && log && (
        <>
          <p className="plan-sum">
            {done} concluídas{reverted ? ` · ${reverted} desfeitas` : ""}
            {failed.length ? ` · ${failed.length} com problema` : ""}.
          </p>
          {failed.slice(0, 3).map((r) => (
            <p key={r.actionId} className="plan-warn">⚠ {r.error}</p>
          ))}
          <div className="plan-actions">
            <button disabled={done === 0} onClick={onUndo}>Desfazer tudo</button>
            <button className="go" onClick={onClose}>Fechar</button>
          </div>
        </>
      )}
    </div>
  );
}
