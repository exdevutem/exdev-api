import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { RolesController, SpecialtiesController } from './catalogs.controller';
import { CatalogsService } from './catalogs.service';
@Module({
  imports: [SharedModule],
  controllers: [RolesController, SpecialtiesController],
  providers: [CatalogsService],
})
export class CatalogsModule {}
