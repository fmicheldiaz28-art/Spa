import { Leaf } from 'lucide-react';

export function Brand({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  return (
    <span className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight">
      <span className="grid size-8 place-items-center rounded-lg bg-sidebar-accent/20 text-sidebar-accent">
        <Leaf className="size-5" aria-hidden />
      </span>
      <span className={tone === 'light' ? 'text-white' : 'text-text'}>NaturalSpa</span>
    </span>
  );
}
