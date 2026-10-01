import type { Transaction } from 'dexie';
import type { TableName } from '../core/model/types';
import { SCHEMA_VERSION, TABLES } from '../core/model/types';

// Schema versions. Dexie upgrades run in the browser; export files carry schemaVersion and run
// the same data migrations on import.

export interface DbVersion {
  version: number;
  /** Tables that exist in this version. */
  tables: readonly TableName[];
  /** Index spec overrides per table; default is the primary key only. */
  indexes: Partial<Record<TableName, string>>;
  upgrade?: (tx: Transaction) => Promise<void>;
}

const V1_INDEXES: Partial<Record<TableName, string>> = {
  milestones: '&id, goalId',
  tasks: '&id, goalId, milestoneId',
  sessions: '&id, goalId',
  executionRecords: '&id, taskId, sessionId',
  evidence: '&id, taskId',
};
const V1_TABLES = TABLES.filter((t) => t !== 'checkins');

export const DB_VERSIONS: DbVersion[] = [
  { version: 1, tables: V1_TABLES, indexes: V1_INDEXES },
  // v2: WOOP check-ins (session-start ritual and obstacle moments).
  { version: 2, tables: TABLES, indexes: { ...V1_INDEXES, checkins: '&id, goalId' } },
];

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/** Data migrations for exported files, keyed by the version they upgrade *from*. */
const MIGRATIONS: Record<number, Migration> = {
  1: (d) => ({ ...d, checkins: Array.isArray(d.checkins) ? d.checkins : [] }),
};

export function migrateData(
  data: Record<string, unknown>,
  fromVersion: number,
): Record<string, unknown> {
  if (fromVersion > SCHEMA_VERSION)
    throw new Error(`This file is from a newer version of GoalGraph (schema ${fromVersion}).`);
  let d = data;
  for (let v = fromVersion; v < SCHEMA_VERSION; v++) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`No migration from schema ${v}`);
    d = m(d);
  }
  return d;
}
