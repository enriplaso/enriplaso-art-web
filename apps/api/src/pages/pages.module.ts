import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminPagesController } from './admin-pages.controller';
import { PagesController } from './pages.controller';
import { PagesService } from './pages.service';

@Module({
  imports: [AuthModule],
  controllers: [PagesController, AdminPagesController],
  providers: [PagesService],
})
export class PagesModule {}
