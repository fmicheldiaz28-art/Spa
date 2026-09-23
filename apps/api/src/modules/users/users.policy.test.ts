import { describe, expect, it } from 'vitest';
import { canAssignRole, canChangeRole, canDeactivate, canManageTarget } from './users.policy.js';

describe('canManageTarget', () => {
  it('un admin no puede gestionar a un super admin', () => {
    expect(canManageTarget(['ADMIN'], ['SUPER_ADMIN'])).toBe('CANNOT_MANAGE_SUPER_ADMIN');
  });
  it('un admin puede gestionar empleadas y otros admins', () => {
    expect(canManageTarget(['ADMIN'], ['EMPLEADA'])).toBeNull();
    expect(canManageTarget(['ADMIN'], ['ADMIN'])).toBeNull();
  });
  it('un super admin puede gestionar a otro super admin', () => {
    expect(canManageTarget(['SUPER_ADMIN'], ['SUPER_ADMIN'])).toBeNull();
  });
});

describe('canAssignRole', () => {
  it('un admin no puede asignar SUPER_ADMIN (sin auto-elevación)', () => {
    expect(canAssignRole(['ADMIN'], 'SUPER_ADMIN')).toBe('ROLE_NOT_ASSIGNABLE');
  });
  it('un admin puede asignar ADMIN y EMPLEADA', () => {
    expect(canAssignRole(['ADMIN'], 'ADMIN')).toBeNull();
    expect(canAssignRole(['ADMIN'], 'EMPLEADA')).toBeNull();
  });
  it('nadie asigna CLIENTE desde la gestión de personal', () => {
    expect(canAssignRole(['SUPER_ADMIN'], 'CLIENTE')).toBe('ROLE_NOT_ASSIGNABLE');
  });
});

describe('canDeactivate', () => {
  it('nadie se desactiva a sí mismo', () => {
    expect(canDeactivate('u1', 'u1', ['ADMIN'], 2)).toBe('CANNOT_DEACTIVATE_SELF');
  });
  it('no se desactiva al último super admin', () => {
    expect(canDeactivate('u1', 'u2', ['SUPER_ADMIN'], 1)).toBe('LAST_SUPER_ADMIN');
  });
  it('se puede desactivar a un super admin si quedan otros', () => {
    expect(canDeactivate('u1', 'u2', ['SUPER_ADMIN'], 2)).toBeNull();
  });
  it('se puede desactivar a una empleada', () => {
    expect(canDeactivate('u1', 'u2', ['EMPLEADA'], 1)).toBeNull();
  });
});

describe('canChangeRole', () => {
  it('no se le quita el rol al último super admin', () => {
    expect(canChangeRole(['SUPER_ADMIN'], 'ADMIN', 1)).toBe('LAST_SUPER_ADMIN');
  });
  it('permite cambiar el rol de otros usuarios', () => {
    expect(canChangeRole(['EMPLEADA'], 'ADMIN', 1)).toBeNull();
  });
});
