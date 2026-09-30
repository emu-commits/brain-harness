import type { ImageBlob, TableName, Workspace } from '../core/model/types';
import { TABLE_KEYS, TABLES } from '../core/model/types';

/** Persistence port. The app talks to this; tests use MemoryStorage. */
export interface Storage {
  load(): Promise<Workspace>;
  /** Persist the difference between two workspaces atomically. */
  commit(prev: Workspace, next: Workspace): Promise<void>;
  /** Replace everything atomically (import). */
  replaceAll(ws: Workspace, images: ImageBlob[]): Promise<void>;
  clear(): Promise<void>;
  putImage(img: ImageBlob): Promise<void>;
  getImage(id: string): Promise<ImageBlob | undefined>;
  allImages(): Promise<ImageBlob[]>;
}

export interface TableDiff {
  table: TableName;
  puts: unknown[];
  deletes: string[];
}

/** Rows added or changed (by reference) and keys removed, per table. */
export function diffWorkspaces(prev: Workspace, next: Workspace): TableDiff[] {
  const out: TableDiff[] = [];
  for (const table of TABLES) {
    const a = prev[table] as unknown as Record<string, unknown>[];
    const b = next[table] as unknown as Record<string, unknown>[];
    if (a === b) continue;
    const key = TABLE_KEYS[table];
    const before = new Map(a.map((r) => [r[key] as string, r]));
    const after = new Set<string>();
    const puts: unknown[] = [];
    for (const r of b) {
      const k = r[key] as string;
      after.add(k);
      if (before.get(k) !== r) puts.push(r);
    }
    const deletes = [...before.keys()].filter((k) => !after.has(k));
    if (puts.length || deletes.length) out.push({ table, puts, deletes });
  }
  return out;
}

export class MemoryStorage implements Storage {
  private data: Workspace;
  private images = new Map<string, ImageBlob>();

  constructor(initial: Workspace) {
    this.data = structuredClone(initial);
  }
  async load() {
    return structuredClone(this.data);
  }
  async commit(_prev: Workspace, next: Workspace) {
    this.data = structuredClone(next);
  }
  async replaceAll(ws: Workspace, images: ImageBlob[]) {
    this.data = structuredClone(ws);
    this.images = new Map(images.map((i) => [i.id, i]));
  }
  async clear() {
    for (const t of TABLES) (this.data as unknown as Record<string, unknown[]>)[t] = [];
    this.images.clear();
  }
  async putImage(img: ImageBlob) {
    this.images.set(img.id, img);
  }
  async getImage(id: string) {
    return this.images.get(id);
  }
  async allImages() {
    return [...this.images.values()];
  }
}
