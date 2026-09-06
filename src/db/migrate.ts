import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Database } from './database.js'

export async function migrate(database: Database, migrationsDir = resolve(process.cwd(), 'migrations')) {
  await database.exec(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `)
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort()
  for (const name of files) {
    const existing = await database.query<{ name: string }>('select name from schema_migrations where name = $1', [name])
    if (existing.rows.length) continue
    const sql = await readFile(resolve(migrationsDir, name), 'utf8')
    await database.transaction(async (transaction) => {
      await transaction.exec(sql)
      await transaction.query('insert into schema_migrations(name) values($1)', [name])
    })
  }
}
