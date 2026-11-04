import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from './prisma/prisma.service';
import { Publico } from './modules/auth/permisos.decorator';

@ApiTags('salud')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Publico()
  @Get()
  async check() {
    const [{ version }] = await this.prisma.$queryRaw<{ version: string }[]>`SELECT VERSION() AS version`;
    return { estado: 'ok', baseDeDatos: version, entornoSunat: process.env.SUNAT_ENTORNO ?? 'BETA', hora: new Date().toISOString() };
  }
}
