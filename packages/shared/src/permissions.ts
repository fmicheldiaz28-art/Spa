/**
 * Catálogo único de permisos (docs/07-roles-permisos.md §11.3).
 * Lo usan el seed de la base de datos, los guards del API y el frontend.
 */
export interface PermissionDefinition {
  code: string;
  module: string;
  description: string;
  sensitive: boolean;
}

const p = (code: string, description: string, sensitive = false): PermissionDefinition => ({
  code,
  module: code.split('.')[0]!,
  description,
  sensitive,
});

export const PERMISSION_CATALOG = [
  // Plataforma
  p('platform.manage', 'Gestionar organizaciones, planes y sedes (SaaS)', true),
  // Usuarios y roles
  p('users.read', 'Ver usuarios'),
  p('users.create', 'Crear usuarios', true),
  p('users.update', 'Editar usuarios', true),
  p('users.deactivate', 'Activar, desactivar y cerrar sesiones de usuarios', true),
  p('users.reset_password', 'Forzar cambio de contraseña', true),
  p('roles.read', 'Ver roles y permisos'),
  p('roles.manage', 'Crear y editar roles y permisos', true),
  // Dashboard y reportes
  p('dashboard.view_global', 'Dashboard ejecutivo con montos', true),
  p('dashboard.view_own', 'Dashboard personal "Mi día"'),
  p('reports.view_global', 'Reportes globales', true),
  p('reports.view_own', 'Reporte personal'),
  p('reports.export', 'Exportar reportes', true),
  // Clientes
  p('clients.read_all', 'Ver y buscar todas las clientas', true),
  p('clients.read_assigned', 'Ver clientas con citas asignadas (sin contacto)'),
  p('clients.create', 'Crear clientas'),
  p('clients.update', 'Editar ficha completa de clientas'),
  p('clients.update_service_notes', 'Editar preferencias de servicio'),
  p('clients.view_contact', 'Revelar teléfono y email (auditado)', true),
  p('clients.view_internal_notes', 'Ver observaciones internas', true),
  p('clients.merge', 'Fusionar clientas duplicadas', true),
  p('clients.delete', 'Eliminar clientas (soft delete)', true),
  p('clients.anonymize', 'Anonimizar clientas', true),
  p('clients.import', 'Importar clientas', true),
  p('clients.export', 'Exportar clientas', true),
  // Catálogo
  p('services.read', 'Ver servicios y categorías'),
  p('services.manage', 'Gestionar servicios y categorías'),
  p('packages.read', 'Ver paquetes'),
  p('packages.manage', 'Gestionar paquetes'),
  // Personal y horarios
  p('staff.read_all', 'Ver todas las colaboradoras'),
  p('staff.manage', 'Editar perfiles de colaboradoras'),
  p('schedules.read_all', 'Ver horarios y ausencias de todas'),
  p('schedules.read_own', 'Ver su propio horario y ausencias'),
  p('schedules.manage', 'Gestionar horarios, ausencias, bloqueos y feriados'),
  p('schedules.request', 'Solicitar vacaciones o permisos'),
  p('schedules.approve', 'Aprobar o rechazar solicitudes de ausencia'),
  // Citas
  p('appointments.read_all', 'Ver todas las citas'),
  p('appointments.read_own', 'Ver sus propias citas'),
  p('appointments.create', 'Crear citas'),
  p('appointments.update', 'Editar citas'),
  p('appointments.reschedule', 'Reagendar citas'),
  p('appointments.update_status_all', 'Cambiar el estado de cualquier cita'),
  p('appointments.update_status_own', 'Check-in, completar o no-show de sus citas'),
  p('appointments.cancel', 'Cancelar citas'),
  p('appointments.revert_status', 'Corregir estados finales de citas', true),
  p('appointments.delete', 'Eliminar (soft) y restaurar citas', true),
  p('appointments.overbook', 'Forzar sobre-turno', true),
  p('waitlist.manage', 'Gestionar la lista de espera'),
  // Cobros
  p('payments.read_all', 'Ver cobros', true),
  p('payments.create', 'Registrar cobros'),
  p('payments.void', 'Anular cobros', true),
  p('payments.close_cash', 'Cierre de caja', true),
  // Auditoría y configuración
  p('audit.read', 'Consultar auditoría', true),
  p('audit.export', 'Exportar auditoría', true),
  p('settings.manage', 'Configuración del negocio', true),
  // Cliente final
  p('booking.self', 'Reservar y gestionar sus propias reservas'),
] as const satisfies readonly PermissionDefinition[];

export type Permission = (typeof PERMISSION_CATALOG)[number]['code'];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_CATALOG.map((d) => d.code);
