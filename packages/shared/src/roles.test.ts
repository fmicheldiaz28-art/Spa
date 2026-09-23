import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, PERMISSION_CATALOG } from './permissions.js';
import { ASSIGNABLE_ROLES, ROLE_PERMISSIONS } from './roles.js';

describe('catálogo de permisos', () => {
  it('no tiene códigos duplicados', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('usa el formato modulo.accion', () => {
    for (const { code, module } of PERMISSION_CATALOG) {
      expect(code).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(code.startsWith(`${module}.`)).toBe(true);
    }
  });
});

describe('matriz rol × permiso', () => {
  it('la empleada no puede ver datos globales ni sensibles de clientas', () => {
    const empleada = ROLE_PERMISSIONS.EMPLEADA;
    for (const forbidden of [
      'appointments.read_all',
      'clients.read_all',
      'clients.view_contact',
      'clients.export',
      'dashboard.view_global',
      'reports.view_global',
      'audit.read',
      'users.read',
    ]) {
      expect(empleada).not.toContain(forbidden);
    }
    expect(empleada).toContain('appointments.read_own');
  });

  it('el admin no gestiona la plataforma ni los roles', () => {
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain('platform.manage');
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain('roles.manage');
    expect(ROLE_PERMISSIONS.ADMIN).toContain('audit.read');
  });

  it('el super admin tiene todo excepto las acciones de cliente final', () => {
    expect(ROLE_PERMISSIONS.SUPER_ADMIN).toHaveLength(ALL_PERMISSIONS.length - 1);
  });

  it('el cliente solo gestiona sus reservas', () => {
    expect(ROLE_PERMISSIONS.CLIENTE).toEqual(['booking.self']);
  });

  it('nadie por debajo de super admin puede asignar SUPER_ADMIN', () => {
    expect(ASSIGNABLE_ROLES.ADMIN).not.toContain('SUPER_ADMIN');
    expect(ASSIGNABLE_ROLES.EMPLEADA).toEqual([]);
  });
});
