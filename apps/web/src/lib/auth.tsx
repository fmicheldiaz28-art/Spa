'use client';

import type { Permission, SystemRole } from '@naturalspa/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, refreshSession, setAccessToken } from './api';

export interface Me {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  roles: SystemRole[];
  permissions: Permission[];
  staffId: string | null;
  mustChangePassword: boolean;
}

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  status: Status;
  user: Me | null;
  login: (email: string, password: string) => Promise<Me>;
  logout: () => Promise<void>;
  reload: () => Promise<Me | null>;
  can: (...permissions: Permission[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<Me | null>(null);

  const reload = useCallback(async () => {
    try {
      const me = await api<Me>('/auth/me');
      setUser(me);
      setStatus('authenticated');
      return me;
    } catch {
      setUser(null);
      setStatus('anonymous');
      return null;
    }
  }, []);

  // Restaura la sesión al cargar (cookie de refresh).
  useEffect(() => {
    void refreshSession().then(async (ok) => {
      if (ok) await reload();
      else setStatus('anonymous');
    });
  }, [reload]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { accessToken } = await api<{ accessToken: string }>(
        '/auth/login',
        { method: 'POST', body: JSON.stringify({ email, password }) },
        false, // un 401 aquí es "credenciales incorrectas", no una sesión vencida
      );
      setAccessToken(accessToken);
      const me = await reload();
      if (!me) throw new Error('No se pudo cargar el perfil');
      return me;
    },
    [reload],
  );

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setAccessToken(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      login,
      logout,
      reload,
      can: (...permissions) => !!user && permissions.some((p) => user.permissions.includes(p)),
    }),
    [status, user, login, logout, reload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}

/** Ruta de inicio según el rol (docs/06-modulos.md M1). */
export function homeFor(user: Me): string {
  if (user.mustChangePassword) return '/cambiar-contrasena';
  return user.permissions.includes('dashboard.view_global') ? '/app/dashboard' : '/app/mi-dia';
}
