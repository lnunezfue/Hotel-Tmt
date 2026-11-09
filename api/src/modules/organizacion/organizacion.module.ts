import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizacionController } from './organizacion.controller';
import { UsuariosService } from './application/usuarios.service';
import { RolesService } from './application/roles.service';

@Module({ imports: [AuthModule], controllers: [OrganizacionController], providers: [UsuariosService, RolesService] })
export class OrganizacionModule {}
