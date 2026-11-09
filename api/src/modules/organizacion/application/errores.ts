import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReglaUsuarioError } from '../domain/usuario';

/** Traduce reglas de dominio y claves únicas a respuestas HTTP; deja pasar lo demás. */
export function traducirError(e: unknown, duplicado: string): never {
  if (e instanceof ReglaUsuarioError) throw new BadRequestException(e.message);
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(duplicado);
  throw e;
}
