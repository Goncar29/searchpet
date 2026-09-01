import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { apiClient } from '@shared/api/client';
import { controlClass } from '../../components/form/FormField';
import { AdminsPage } from './AdminsPage';

/**
 * Escrito ANTES de tocarle el marcado, igual que los de Casas de acogida: así
 * caracteriza lo que la pantalla hace hoy y el rediseño tiene contra qué
 * chocar. Se afirma comportamiento, no estructura.
 *
 * Es la pantalla del proyecto donde eso más importa: acá se OTORGA Y SE REVOCA
 * el rol admin. Un rediseño que rompiera en silencio el botón de revocar deja
 * a alguien con permisos que se le quisieron sacar.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${Object.values(opts).join(',')}` : key,
    i18n: { language: 'es' },
  }),
}));

let auditoria: unknown[] = [];
let fallaAuditoria = false;

vi.mock('@shared/api/client', () => ({
  apiClient: {
    getRoleChanges: vi.fn(() =>
      fallaAuditoria
        ? Promise.reject(new Error('boom'))
        : Promise.resolve({ data: auditoria, total: auditoria.length }),
    ),
    setUserAdmin: vi.fn(() => Promise.resolve({ email: 'ana@test.uy', no_change: false })),
  },
}));

vi.mock('@shared/utils/apiErrors', () => ({ getErrorMessage: () => 'error' }));

const mockedApi = vi.mocked(apiClient);

function pintar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AdminsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auditoria = [
    {
      id: 'a-1',
      created_at: '2026-08-31T12:00:00Z',
      actor_email: 'jefe@test.uy',
      action: 'grant',
      target_email: 'ana@test.uy',
    },
  ];
  fallaAuditoria = false;
  vi.clearAllMocks();
});

describe('AdminsPage', () => {
  it('dibuja la auditoría con actor, acción y destinatario', async () => {
    pintar();

    expect(await screen.findByText('jefe@test.uy')).toBeTruthy();
    expect(screen.getByText('admins.actionGrant')).toBeTruthy();
    expect(screen.getByText('ana@test.uy')).toBeTruthy();
  });

  // Las dos mitades del mismo control. Sin la de revocar, un rediseño que
  // cablee los dos botones a `grant` pasa verde y OTORGA donde debía sacar.
  it('otorgar manda grant=true y revocar grant=false', async () => {
    pintar();
    const campo = screen.getByPlaceholderText('admins.emailPlaceholder');

    fireEvent.change(campo, { target: { value: '  ana@test.uy  ' } });
    fireEvent.click(screen.getByText('admins.grant'));
    await waitFor(() =>
      expect(mockedApi.setUserAdmin).toHaveBeenCalledWith('ana@test.uy', true),
    );

    fireEvent.change(campo, { target: { value: 'otro@test.uy' } });
    fireEvent.click(screen.getByText('admins.revoke'));
    await waitFor(() =>
      expect(mockedApi.setUserAdmin).toHaveBeenCalledWith('otro@test.uy', false),
    );
  });

  // Este NO pasaba antes del rediseño, y por eso está: el `<label>` no tenía
  // `htmlFor` y el `<input>` no tenía `id`, así que el campo donde se escribe
  // el email de alguien a quien se le va a dar o sacar admin NO TENÍA NOMBRE
  // ACCESIBLE. Se veía perfecto y un lector de pantalla anunciaba un cuadro de
  // texto sin decir de qué. Es la trampa que `FormField` cierra por
  // construcción: su render prop hace imposible olvidarse el cableado.
  it('el campo del email está etiquetado de verdad', () => {
    pintar();

    expect(screen.getByLabelText('admins.emailLabel')).toBeTruthy();
  });

  // Se afirma contra `controlClass()` y NO contra un padding concreto: lo que
  // importa es que el control lleve la clase que `FormField` le entrega, no
  // cuánto mide. Atarlo a `px-6` se rompería el día que el sistema cambie su
  // densidad, sin que nada se hubiera roto.
  //
  // Existe porque el control SÍ se pisaba: `{...control}` traía el className del
  // sistema y un `className=` literal escrito después lo sobreescribía entero
  // (en JSX gana la prop posterior). El campo quedaba con el estilado viejo y
  // sin el `focus:ring` del sistema. Nada lo delataba: `id` y `htmlFor` no se
  // pisan, así que el nombre accesible estaba bien y `getByLabelText` pasaba.
  it('el input adopta el estilado que le entrega FormField', () => {
    pintar();

    expect(screen.getByLabelText('admins.emailLabel').className).toBe(controlClass());
  });

  it('sin email los dos botones están deshabilitados', () => {
    pintar();

    expect(screen.getByText('admins.grant')).toBeDisabled();
    expect(screen.getByText('admins.revoke')).toBeDisabled();
  });

  // Una auditoría que no cargó no es una auditoría vacía: decir "no hay
  // cambios recientes" cuando la consulta falló le afirma a un admin que nadie
  // tocó los permisos, que es lo único que esta tabla existe para desmentir.
  it('con la auditoría caída avisa, y NUNCA dice que no hay cambios', async () => {
    fallaAuditoria = true;
    pintar();

    expect(await screen.findByText('admins.recentError')).toBeTruthy();
    expect(screen.queryByText('admins.recentEmpty')).toBeNull();
  });

  it('con la auditoría vacía lo dice', async () => {
    auditoria = [];
    pintar();

    expect(await screen.findByText('admins.recentEmpty')).toBeTruthy();
  });
});
