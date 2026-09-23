import type { SystemRole } from '@naturalspa/shared';

export interface StaffUser {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string | null;
  role: SystemRole | null;
  status: 'ACTIVE' | 'INACTIVE' | 'LOCKED' | 'PENDING_VERIFICATION';
  locked: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  staff: { id: string; displayName: string; color: string; isBookableOnline: boolean; isActive: boolean } | null;
}

export interface RoleOption {
  code: SystemRole;
  name: string;
  assignable: boolean;
}

export interface Page<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
