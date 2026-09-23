'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { homeFor, useAuth } from '@/lib/auth';

export default function Home() {
  const { status, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
    if (status === 'authenticated' && user) router.replace(homeFor(user));
  }, [status, user, router]);

  return null;
}
