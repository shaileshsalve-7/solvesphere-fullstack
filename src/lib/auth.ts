import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Database } from '../db/database.js'

export type UserRole = 'Citizen' | 'Student' | 'Mentor' | 'Admin'

export interface AuthUser {
  [key: string]: unknown
  id: string
  email: string
  name: string
  role: UserRole
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser | null
  }
}

interface JwtClaims {
  sub: string
  email: string
}

export function requireAuth(database: Database, roles?: UserRole[]) {
  return async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    let claims: JwtClaims
    try {
      claims = await request.jwtVerify<JwtClaims>()
    } catch {
      return reply.code(401).send({ error: 'unauthorized', message: 'A valid access token is required.' })
    }
    const result = await database.query<AuthUser>(
      'select id, email, name, role from profiles where id = $1',
      [claims.sub],
    )
    const user = result.rows[0]
    if (!user) return reply.code(401).send({ error: 'unauthorized', message: 'The account no longer exists.' })
    if (roles && !roles.includes(user.role)) {
      return reply.code(403).send({ error: 'forbidden', message: 'Your account does not have permission for this action.' })
    }
    request.authUser = user
  }
}
