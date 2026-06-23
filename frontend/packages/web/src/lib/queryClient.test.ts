import { describe, it, expect } from 'vitest';
import { createQueryClient } from './queryClient';

describe('createQueryClient', () => {
  it('usa un staleTime corto (30s) para que la data se refresque al navegar/volver a la pestaña', () => {
    const opts = createQueryClient().getDefaultOptions();
    // 5 minutes was too long for a collaborative app: data changed by another
    // user/session stayed frozen until a manual page refresh (backlog #12).
    expect(opts.queries?.staleTime).toBe(30 * 1000);
  });

  it('refetchea al recuperar el foco de la ventana', () => {
    const opts = createQueryClient().getDefaultOptions();
    expect(opts.queries?.refetchOnWindowFocus).toBe(true);
  });

  it('mantiene los reintentos en 2', () => {
    const opts = createQueryClient().getDefaultOptions();
    expect(opts.queries?.retry).toBe(2);
  });
});
