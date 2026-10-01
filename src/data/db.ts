import Dexie, { type Table } from 'dexie';
import type { ImageBlob, TableName, Workspace } from '../core/model/types';
import { TABLE_KEYS, TABLES } from '../core/model/types';
import { emptyWorkspace } from '../core/model/factories';
import type { Storage } from './storage';
import { diffWorkspaces } from './storage';
import { DB_VERSIONS } from './migrations';

// IndexedDB via Dexie: one normalized table per entity, images as Blobs in their own table.

export class GoalGraphDB extends Dexie {
  images!: Table<ImageBlob, string>;

  constructor(name = 'goalgraph') {
    super(name);
    for (const v of DB_VERSIONS) {
      const schema: Record<string, string> = { images: '&id' };
      for (const t of v.tables) schema[t] = v.indexes[t] ?? `&${TABLE_KEYS[t]}`;
      const ver = this.version(v.version).stores(schema);
      if (v.upgrade) ver.upgrade(v.upgrade);
    }
  }

  table_(t: TableName): Table<unknown, string> {
    return this.table(t);
  }
}

export class DexieStorage implements Storage {
  constructor(private db: GoalGraphDB) {}

  async load(): Promise<Workspace> {
    const ws = emptyWorkspace();
    await this.db.transaction(
      'r',
      TABLES.map((t) => this.db.table_(t)),
      async () => {
        for (const t of TABLES)
          (ws as unknown as Record<string, unknown[]>)[t] = await this.db.table_(t).toArray();
      },
    );
    return ws;
  }

  async commit(prev: Workspace, next: Workspace): Promise<void> {
    const diffs = diffWorkspaces(prev, next);
    if (!diffs.length) return;
    await this.db.transaction(
      'rw',
      diffs.map((d) => this.db.table_(d.table)),
      async () => {
        for (const d of diffs) {
          const table = this.db.table_(d.table);
          if (d.deletes.length) await table.bulkDelete(d.deletes);
          if (d.puts.length) await table.bulkPut(d.puts);
        }
      },
    );
  }

  async replaceAll(ws: Workspace, images: ImageBlob[]): Promise<void> {
    const tables = [...TABLES.map((t) => this.db.table_(t)), this.db.images];
    await this.db.transaction('rw', tables, async () => {
      for (const t of tables) await t.clear();
      for (const t of TABLES) {
        const rows = ws[t] as unknown[];
        if (rows.length) await this.db.table_(t).bulkPut(rows);
      }
      if (images.length) await this.db.images.bulkPut(images);
    });
  }

  async clear(): Promise<void> {
    await this.replaceAll(emptyWorkspace(), []);
  }

  async putImage(img: ImageBlob) {
    await this.db.images.put(img);
  }
  async getImage(id: string) {
    return this.db.images.get(id);
  }
  async allImages() {
    return this.db.images.toArray();
  }
}
