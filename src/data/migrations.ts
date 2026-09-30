import type { Transaction } from 'dexie';
import type { TableName } from '../core/model/types';
import { SCHEMA_VERSION } from '../core/model/types';

// Schema versions. Dexie upgrades run in the browser; export files carry schemaVersion and run
// the same data migrations on import.

export interface DbVersion {
  version: number;
  /** Index spec overrides per table; default is the primary key only. */
  indexes: Partial<Record<TableName, string>>;
  upgrade?: (tx: Transaction) => Promise<void>;
}

export const DB_VERSIONS: DbVersion[] = [
  {
    version: 1,
    indexes: {
      milestones: '&id, goalId',
      tasks: '&id, goalId, milestoneId',
      sessions: '&id, goalId',
      executionRecords: '&id, taskId, sessionId',
      evidence: '&id, taskId',
    },
  },
];

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/** Data migrations for exported files, keyed by the version they upgrade *from*. */
const MIGRATIONS: Record<number, Migration> = {};

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
