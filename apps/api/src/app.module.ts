import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module.js';
import { PrismaModule } from './infrastructure/prisma/prisma.module.js';
import { AppointmentsModule } from './modules/appointments/appointments.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AvailabilityModule } from './modules/availability/availability.module.js';
import { BookingModule } from './modules/booking/booking.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { ClientsModule } from './modules/clients/clients.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { HealthController } from './modules/health/health.controller.js';
import { OrganizationModule } from './modules/organization/organization.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { SchedulingModule } from './modules/scheduling/scheduling.module.js';
import { UsersModule } from './modules/users/users.module.js';

@Module({
  imports: [
    PrismaModule,
    CommonModule,
    AuditModule,
    EventsModule,
    AuthModule,
    UsersModule,
    CatalogModule,
    SchedulingModule,
    AvailabilityModule,
    ClientsModule,
    AppointmentsModule,
    PaymentsModule,
    DashboardModule,
    BookingModule,
    ReportsModule,
    OrganizationModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
