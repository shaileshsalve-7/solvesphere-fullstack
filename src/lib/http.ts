import type { FastifyReply } from 'fastify'
import type { ZodType } from 'zod'

export function parse<T>(schema: ZodType<T>, value: unknown, reply: FastifyReply): T | undefined {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  void reply.code(400).send({
    error: 'validation_error',
    message: 'The request contains invalid data.',
    details: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  })
  return undefined
}

export function notFound(reply: FastifyReply, resource: string) {
  return reply.code(404).send({ error: 'not_found', message: `${resource} was not found.` })
}

export function conflict(reply: FastifyReply, message: string) {
  return reply.code(409).send({ error: 'conflict', message })
}
