'use client';

/** Лампочка канала. Живёт отдельно: её показывают и чипы каналов, и полоса. */
export function StatusDot({ status }: { status: string }) {
  const color =
    status === 'listening'
      ? 'var(--ok)'
      : status === 'connecting' || status === 'reconnecting'
        ? 'var(--warn)'
        : status === 'error'
          ? 'var(--err)'
          : 'var(--line)';
  return <i className="dot" style={{ background: color }} title={status} />;
}
