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
  transaction<T>(callback: (database: Database) => Promise<T>): Promise<T>
  close(): Promise<void>
}

export async function createDatabase(config: AppConfig): Promise<Database> {
  if (config.databaseMode === 'postgres') {
    const pool = new pg.Pool({ connectionString: config.databaseUrl })
    await pool.query('select 1')
    const database: Database = {
      async query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
        const result = await pool.query(sql, params)
        return { rows: result.rows as T[], affectedRows: result.rowCount ?? 0 }
      },
      async exec(sql: string) { await pool.query(sql) },
      async transaction<T>(callback: (database: Database) => Promise<T>) {
        const client = await pool.connect()
        const transactionDatabase: Database = {
          async query<TResult extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
            const result = await client.query(sql, params)
            return { rows: result.rows as TResult[], affectedRows: result.rowCount ?? 0 }
          },
          async exec(sql: string) { await client.query(sql) },
          async transaction<TResult>(nested: (database: Database) => Promise<TResult>) { return nested(transactionDatabase) },
          async close() {},
        }
        await client.query('begin')
        try {
          const result = await callback(transactionDatabase)
          await client.query('commit')
          return result
        } catch (error) {
          await client.query('rollback')
          throw error
        } finally {
          client.release()
        }
      },
      async close() { await pool.end() },
    }
    return database
  }

  if (config.pgliteDataDir !== 'memory://') await mkdir(dirname(config.pgliteDataDir), { recursive: true })
  const client = config.pgliteDataDir === 'memory://' ? new PGlite() : new PGlite(config.pgliteDataDir)
  await client.waitReady
  const database: Database = {
    async query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const result = await client.query<T>(sql, params)
      return { rows: result.rows, affectedRows: result.affectedRows ?? 0 }
    },
    async exec(sql: string) { await client.exec(sql) },
    async transaction<T>(callback: (database: Database) => Promise<T>) {
      return client.transaction(async (transaction) => {
        const transactionDatabase: Database = {
          async query<TResult extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
            const result = await transaction.query<TResult>(sql, params)
            return { rows: result.rows, affectedRows: result.affectedRows ?? 0 }
          },
          async exec(sql: string) { await transaction.exec(sql) },
          async transaction<TResult>(nested: (database: Database) => Promise<TResult>) { return nested(transactionDatabase) },
          async close() {},
        }
        return callback(transactionDatabase)
      })
    },
    async close() { await client.close() },
  }
  return database
}
