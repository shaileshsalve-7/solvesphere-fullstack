import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import pg from 'pg'
import type { AppConfig } from '../config.js'

export interface SqlResult<T> {
  rows: T[]
  affectedRows: number
}

export interface Database {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<SqlResult<T>>
  exec(sql: string): Promise<void>
  close(): Promise<void>
}

export async function createDatabase(config: AppConfig): Promise<Database> {
  if (config.databaseMode === 'postgres') {
    const pool = new pg.Pool({ connectionString: config.databaseUrl })
    await pool.query('select 1')
    return {
      async query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
        const result = await pool.query(sql, params)
        return { rows: result.rows as T[], affectedRows: result.rowCount ?? 0 }
      },
      async exec(sql: string) { await pool.query(sql) },
      async close() { await pool.end() },
    }
  }

  if (config.pgliteDataDir !== 'memory://') await mkdir(dirname(config.pgliteDataDir), { recursive: true })
  const client = config.pgliteDataDir === 'memory://' ? new PGlite() : new PGlite(config.pgliteDataDir)
  await client.waitReady
  return {
    async query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const result = await client.query<T>(sql, params)
      return { rows: result.rows, affectedRows: result.affectedRows ?? 0 }
    },
    async exec(sql: string) { await client.exec(sql) },
    async close() { await client.close() },
  }
}
