/** Só o que o Astrolabe usa da API do Google Drive v3. Trocável por um falso nos testes. */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  viewedByMeTime?: string;
  parents?: string[];
  md5Checksum?: string;
  ownedByMe?: boolean;
}

export interface DriveApi {
  rootId(): Promise<string>;
  /** Uma página de arquivos não-lixeira. */
  list(pageToken?: string): Promise<{ files: DriveFile[]; nextPageToken?: string }>;
  createFolder(name: string, parentId: string): Promise<string>;
  /** Move e/ou renomeia (troca de pai). */
  move(fileId: string, opts: { addParent?: string; removeParent?: string; name?: string }): Promise<void>;
  trash(fileId: string): Promise<void>;
}

export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";

const BASE = "https://www.googleapis.com/drive/v3";
const FIELDS = "nextPageToken,files(id,name,mimeType,size,modifiedTime,viewedByMeTime,parents,md5Checksum,ownedByMe)";

/** Implementação com fetch; o token de acesso vem do login Google do usuário e fica só na memória. */
export class FetchDriveApi implements DriveApi {
  constructor(
    private token: string,
    private fetchFn: typeof fetch = fetch,
  ) {}

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchFn(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json", ...init?.headers },
    });
    if (!res.ok) {
      const msg = res.status === 401 ? "A sessão do Google expirou. Conecte de novo." : res.status === 403 ? "O Google negou a permissão para essa operação." : `Erro ${res.status} do Google Drive`;
      throw new Error(msg);
    }
    return (await res.json()) as T;
  }

  async rootId() {
    return (await this.req<{ id: string }>("/files/root?fields=id")).id;
  }

  list(pageToken?: string) {
    const q = new URLSearchParams({ q: "trashed=false and 'me' in owners", pageSize: "1000", fields: FIELDS, spaces: "drive" });
    if (pageToken) q.set("pageToken", pageToken);
    return this.req<{ files: DriveFile[]; nextPageToken?: string }>(`/files?${q}`);
  }

  async createFolder(name: string, parentId: string) {
    const r = await this.req<{ id: string }>("/files?fields=id", { method: "POST", body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }) });
    return r.id;
  }

  async move(fileId: string, o: { addParent?: string; removeParent?: string; name?: string }) {
    const q = new URLSearchParams({ fields: "id" });
    if (o.addParent) q.set("addParents", o.addParent);
    if (o.removeParent) q.set("removeParents", o.removeParent);
    await this.req(`/files/${encodeURIComponent(fileId)}?${q}`, { method: "PATCH", body: JSON.stringify(o.name ? { name: o.name } : {}) });
  }

  async trash(fileId: string) {
    await this.req(`/files/${encodeURIComponent(fileId)}?fields=id`, { method: "PATCH", body: JSON.stringify({ trashed: true }) });
  }
}
