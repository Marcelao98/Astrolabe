import { Executor, type Approval, type ExecutionLog, type Plan } from "@astrolabe/actions";
import { DRIVE_ROOT_PATH, DriveFsDriver, FetchDriveApi, scanDrive, type DriveScan } from "@astrolabe/drive";
import type { Runner } from "./agent";

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: {
            client_id: string;
            scope: string;
            callback: (r: { access_token?: string; error?: string }) => void;
            error_callback?: (e: { type: string }) => void;
          }): { requestAccessToken(o?: { prompt?: string }): void };
        };
      };
    };
  }
}

export const GOOGLE_CLIENT_ID: string = (import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_GOOGLE_CLIENT_ID ?? "";
const READ = "https://www.googleapis.com/auth/drive.metadata.readonly";
const FULL = "https://www.googleapis.com/auth/drive";

function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => ok();
    s.onerror = () => fail(new Error("Não consegui carregar o login do Google."));
    document.head.append(s);
  });
}

/** Login Google no navegador. O token fica só na memória desta aba. */
export async function googleToken(allowChanges: boolean): Promise<string> {
  if (!GOOGLE_CLIENT_ID) throw new Error("Falta configurar VITE_GOOGLE_CLIENT_ID (veja o README).");
  await loadGis();
  return new Promise((ok, fail) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: allowChanges ? FULL : READ,
      callback: (r) => (r.access_token ? ok(r.access_token) : fail(new Error(r.error ?? "Login cancelado."))),
      error_callback: (e) => fail(new Error(e.type === "popup_closed" ? "Login cancelado." : "Falha no login do Google.")),
    });
    client.requestAccessToken();
  });
}

class DriveRunner implements Runner {
  readonly demo = false;
  private exec: Executor | null;
  constructor(driver: DriveFsDriver | null) {
    this.exec = driver ? new Executor({ driver, quarantineRoot: `${DRIVE_ROOT_PATH}/.astrolabe-quarantine` }) : null;
  }
  private need(): Executor {
    if (!this.exec) throw new Error("Conectado só para leitura. Conecte de novo permitindo alterações para a Astra organizar.");
    return this.exec;
  }
  execute(plan: Plan, approval: Approval): Promise<ExecutionLog> {
    return this.need().execute(plan, approval);
  }
  undo(plan: Plan, log: ExecutionLog): Promise<ExecutionLog> {
    return this.need().undo(plan, log);
  }
}

export async function connectDrive(allowChanges: boolean): Promise<{ scan: DriveScan; runner: Runner }> {
  const token = await googleToken(allowChanges);
  const api = new FetchDriveApi(token);
  const scan = await scanDrive(api);
  return { scan, runner: new DriveRunner(allowChanges ? new DriveFsDriver(api, scan) : null) };
}
