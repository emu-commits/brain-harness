import type { ImageBlob, Workspace } from '../core/model/types';
import { SCHEMA_VERSION, TABLES } from '../core/model/types';
import { validateWorkspace } from '../core/validation/validate';
import type { Result } from '../core/util/result';
import { err, ok } from '../core/util/result';
import { migrateData } from './migrations';

// Export / import (SPEC §11). Import validates fully before anything is written.

export const EXPORT_FORMAT = 'goalgraph-export';

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  data: Workspace;
  images: { id: string; type: string; base64: string }[];
}

export async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function base64ToBlob(s: string, type: string): Blob {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function exportWorkspace(
  ws: Workspace,
  images: ImageBlob[],
  exportedAt: string,
): Promise<string> {
  // Transient UI state isn't part of an export.
  const settings = ws.settings.map((s) => {
    const rest = { ...s };
    delete rest.running;
    return rest;
  });
  const file: ExportFile = {
    format: EXPORT_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt,
    data: { ...ws, settings },
    images: await Promise.all(
      images.map(async (i) => ({ id: i.id, type: i.type, base64: await blobToBase64(i.blob) })),
    ),
  };
  return JSON.stringify(file);
}

export function parseImport(
  text: string,
): Result<{ ws: Workspace; images: ImageBlob[] }, string[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return err(['This file isn’t valid JSON.']);
  }
  if (!raw || typeof raw !== 'object') return err(['This file isn’t a GoalGraph export.']);
  const f = raw as Partial<ExportFile>;
  if (f.format !== EXPORT_FORMAT) return err(['This file isn’t a GoalGraph export.']);
  if (typeof f.schemaVersion !== 'number' || !f.data || typeof f.data !== 'object')
    return err(['The export is missing its data.']);

  let data: Record<string, unknown>;
  try {
    data = migrateData(f.data as unknown as Record<string, unknown>, f.schemaVersion);
  } catch (e) {
    return err([(e as Error).message]);
  }
  const shapeErrors: string[] = [];
  for (const t of TABLES) {
    if (data[t] === undefined) data[t] = [];
    if (!Array.isArray(data[t])) shapeErrors.push(`“${t}” should be a list.`);
    else if ((data[t] as unknown[]).some((r) => !r || typeof r !== 'object'))
      shapeErrors.push(`“${t}” has malformed rows.`);
  }
  if (shapeErrors.length) return err(shapeErrors);
  const ws = data as unknown as Workspace;
  let errors: string[];
  try {
    errors = validateWorkspace(ws).map((e) => `${e.table}: ${e.message}`);
  } catch (e) {
    errors = [`The data couldn’t be read: ${(e as Error).message}`];
  }
  if (errors.length) return err(errors.slice(0, 20));

  const images: ImageBlob[] = [];
  for (const i of f.images ?? []) {
    if (!i || typeof i.id !== 'string' || typeof i.base64 !== 'string')
      return err(['An attached image is malformed.']);
    try {
      images.push({
        id: i.id,
        type: i.type ?? 'application/octet-stream',
        blob: base64ToBlob(i.base64, i.type ?? ''),
      });
    } catch {
      return err(['An attached image is malformed.']);
    }
  }
  return ok({ ws, images });
}

/** Import: parse and validate everything, then replace atomically. On failure nothing changes. */
export async function importInto(
  storage: { replaceAll(ws: Workspace, images: ImageBlob[]): Promise<void> },
  text: string,
): Promise<Result<Workspace, string[]>> {
  const r = parseImport(text);
  if (!r.ok) return r;
  await storage.replaceAll(r.value.ws, r.value.images);
  return ok(r.value.ws);
}
