import 'dotenv/config'
import { loadConfig } from '../config.js'
import { createDatabase } from '../db/database.js'
import { migrate } from '../db/migrate.js'

const config = loadConfig()
const database = await createDatabase(config)
try {
  await migrate(database)
  console.log('Database migrations are up to date.')
} finally {
  await database.close()
}
