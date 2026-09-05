import { resolve } from 'node:path'

export type DatabaseMode = 'pglite' | 'postgres'

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production'
  host: string
  port: number
  corsOrigins: string[]
  databaseMode: DatabaseMode
  pgliteDataDir: string
  databaseUrl?: string
  jwtAccessSecret: string
  accessTokenTtl: string
  refreshTokenDays: number
  devAuthEnabled: boolean
  devOtpCode?: string
  otpDeliveryWebhookUrl?: string
  otpDeliveryApiKey?: string
  bootstrapAdminEmail?: string
  uploadDir: string
  maxUploadBytes: number
}

function bool(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function int(value: string | undefined, fallback: number, name: string) {
  const parsed = Number(value ?? fallback)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? 'development') as AppConfig['nodeEnv']
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('NODE_ENV is invalid')

  const databaseMode = (env.DATABASE_MODE ?? 'pglite') as DatabaseMode
  if (!['pglite', 'postgres'].includes(databaseMode)) throw new Error('DATABASE_MODE must be pglite or postgres')

  const jwtAccessSecret = env.JWT_ACCESS_SECRET ?? ''
  if (jwtAccessSecret.length < 32) throw new Error('JWT_ACCESS_SECRET must contain at least 32 characters')

  const devAuthEnabled = bool(env.DEV_AUTH_ENABLED, nodeEnv !== 'production')
  if (nodeEnv === 'production' && devAuthEnabled) throw new Error('DEV_AUTH_ENABLED cannot be enabled in production')
  if (devAuthEnabled && !/^\d{6}$/.test(env.DEV_OTP_CODE ?? '')) {
    throw new Error('DEV_OTP_CODE must contain exactly 6 digits when development authentication is enabled')
  }
  if (!devAuthEnabled && !env.OTP_DELIVERY_WEBHOOK_URL) {
    throw new Error('OTP_DELIVERY_WEBHOOK_URL is required when development authentication is disabled')
  }
  if (databaseMode === 'postgres' && !env.DATABASE_URL) throw new Error('DATABASE_URL is required for postgres mode')

  return {
    nodeEnv,
    host: env.HOST ?? '127.0.0.1',
    port: int(env.PORT, 4000, 'PORT'),
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((x) => x.trim()).filter(Boolean),
    databaseMode,
    pgliteDataDir: env.PGLITE_DATA_DIR === 'memory://' ? 'memory://' : resolve(env.PGLITE_DATA_DIR ?? './.data/solvesphere'),
    databaseUrl: env.DATABASE_URL,
    jwtAccessSecret,
    accessTokenTtl: env.ACCESS_TOKEN_TTL ?? '15m',
    refreshTokenDays: int(env.REFRESH_TOKEN_DAYS, 7, 'REFRESH_TOKEN_DAYS'),
    devAuthEnabled,
    devOtpCode: env.DEV_OTP_CODE,
    otpDeliveryWebhookUrl: env.OTP_DELIVERY_WEBHOOK_URL,
    otpDeliveryApiKey: env.OTP_DELIVERY_API_KEY,
    bootstrapAdminEmail: env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() || undefined,
    uploadDir: resolve(env.UPLOAD_DIR ?? './uploads'),
    maxUploadBytes: int(env.MAX_UPLOAD_BYTES, 10 * 1024 * 1024, 'MAX_UPLOAD_BYTES'),
  }
}
