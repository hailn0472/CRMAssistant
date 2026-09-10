import { Injectable } from '@nestjs/common'

import type {
  ImportProgress,
  ImportResultResponse,
  ImportStatusResponse,
} from './dto/import-result.dto'

/** How long a finished import stays queryable before it is evicted. */
const ENTRY_TTL_MS = 15 * 60 * 1000

type Entry = ImportStatusResponse & {
  tenantId: string
  updatedAt: number
}

/**
 * Tracks in-flight and recently finished imports so the frontend can poll for
 * progress instead of holding one long request open.
 *
 * Backed by an in-process Map: progress is therefore only visible to the API
 * instance that started the import. That is correct for the current
 * single-instance deployment; moving to Redis (once `ioredis` is introduced)
 * means reimplementing this class and nothing else, since callers only touch
 * the methods below.
 */
@Injectable()
export class ImportProgressStore {
  private readonly entries = new Map<string, Entry>()

  start(importId: string, tenantId: string, totalRows: number, totalBatches: number): void {
    this.evictExpired()
    this.entries.set(importId, {
      importId,
      tenantId,
      status: 'running',
      progress: {
        batch: 0,
        totalBatches,
        imported: 0,
        skipped: 0,
        updated: 0,
        failed: 0,
        totalRows,
      },
      updatedAt: Date.now(),
    })
  }

  update(importId: string, progress: Partial<ImportProgress>): void {
    const entry = this.entries.get(importId)
    if (!entry) return
    entry.progress = { ...entry.progress, ...progress }
    entry.updatedAt = Date.now()
  }

  complete(importId: string, result: ImportResultResponse): void {
    const entry = this.entries.get(importId)
    if (!entry) return
    entry.status = 'completed'
    entry.result = result
    entry.progress = {
      ...entry.progress,
      batch: entry.progress.totalBatches,
      imported: result.imported,
      skipped: result.skipped,
      updated: result.updated,
      failed: result.failed,
    }
    entry.updatedAt = Date.now()
  }

  fail(importId: string, error: string, result: ImportResultResponse): void {
    const entry = this.entries.get(importId)
    if (!entry) return
    entry.status = 'failed'
    entry.error = error
    entry.result = result
    entry.updatedAt = Date.now()
  }

  /**
   * Reads a status entry, scoped to the tenant that owns it so one tenant
   * cannot poll another tenant's import.
   */
  get(importId: string, tenantId: string): ImportStatusResponse | null {
    this.evictExpired()
    const entry = this.entries.get(importId)
    if (!entry || entry.tenantId !== tenantId) return null

    return {
      importId: entry.importId,
      status: entry.status,
      progress: entry.progress,
      ...(entry.result ? { result: entry.result } : {}),
      ...(entry.error ? { error: entry.error } : {}),
    }
  }

  private evictExpired(): void {
    const cutoff = Date.now() - ENTRY_TTL_MS
    for (const [id, entry] of this.entries) {
      if (entry.updatedAt < cutoff) this.entries.delete(id)
    }
  }
}
