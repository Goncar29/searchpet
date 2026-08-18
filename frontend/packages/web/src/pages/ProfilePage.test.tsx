import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router';
import { ApiError } from '@shared/api/client';
import { ProfilePage } from './ProfilePage';
import { MyPetsPage } from './MyPetsPage';
import { MY_PETS_ROUTE } from '../routes';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      // Interpolate so the countdown's seconds are observable in the rendered text.
      if (opts && 'seconds' in opts) return `${key}:${opts.seconds}`;
      // "Miembro desde {{date}}" se interpola igual, porque lo que este test
      // vigila es justamente QUE FECHA entra ahi.
      if (opts && 'date' in opts) return `${key}:${opts.date}`;
      // getErrorMessage treats "t returned the key unchanged" as "no translation
      // exists" and falls back to unknown_error. An identity mock would therefore
      // collapse every code into the same string and assert nothing about which
      // error was surfaced, so error keys must resolve to something distinct.
      if (key.startsWith('errors:')) return `T(${key})`;
      return key;
    },
    i18n: { language: 'es' },
  }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));

// Mutable: cada test decide con que usuario y con que mascotas se renderiza.
const authUser = vi.hoisted(() => ({
  current: {
    id: 'user-1',
    name: 'Carlos',
    email: 'carlos@example.com',
    is_verified: false,
    created_at: '',
  } as Record<string, unknown>,
}));

const petsData = vi.hoisted(() => ({ mine: [] as unknown[], reported: [] as unknown[] }));

const verification = vi.hoisted(() => ({ current: null as { is_verified: boolean } | null }));

const badgesData = vi.hoisted(() => ({ current: [] as unknown[] }));

const refreshUser = vi.hoisted(() => vi.fn());

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: authUser.current, refreshUser }),
}));

// Mutable so each test can drive what the send mutation does.
const sendEmailOTP = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));
const confirmEmailOTP = vi.hoisted(() => ({ mutateAsync: vi.fn(), isPending: false }));

vi.mock('@shared/hooks', () => ({
  // `useDeletePet` y `useUpdatePet` son de MyPetsPage: este archivo la monta de
  // verdad para probar que el "ver todas" ATERRIZA en algún lado.
  useDeletePet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateMe: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useUploadProfilePhoto: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useMyBadges: () => ({ data: badgesData.current }),
  useVerificationStatus: () => ({ data: verification.current }),
  useSendEmailOTP: () => sendEmailOTP,
  useConfirmEmailOTP: () => confirmEmailOTP,
  usePublicProfile: () => ({ data: null, isLoading: false }),
  useMyPets: () => ({ data: petsData.mine, isLoading: false }),
  useReportedPets: () => ({ data: petsData.reported, isLoading: false }),
}));

// Un solo logro conocido: alcanza para probar el estado obtenido y el pendiente
// sin atarse a los seis reales, que viven en shared y cambian por su cuenta.
vi.mock('@shared/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/types')>();
  return {
    ...actual,
    BADGE_META: {
      first_helper: {
        emoji: '🤝',
        labelKey: 'badges:first_helper.label',
        descriptionKey: 'badges:first_helper.description',
        howToEarnKey: 'badges:first_helper.howToEarn',
      },
    },
  };
});

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * Monta el perfil CON su destino, en una tabla de rutas de verdad.
 *
 * Existe porque la version anterior de estos tests afirmaba el `href` — o sea
 * el string que yo mismo habia tipeado — y por eso paso en verde mientras los
 * tres "ver todas" apuntaban a `/my-pets`, una ruta que no existe: medido en el
 * browser, 0 caracteres renderizados. Es la forma de la regla #53: una asercion
 * que tambien se cumple cuando lo que debia verificarse nunca ocurrio.
 *
 * La ruta sale de `MY_PETS_ROUTE`, la MISMA constante que registra `App.tsx`.
 *
 * Y la asercion NO puede ser `pets:mine.title`: ese texto lo renderizan LAS DOS
 * paginas — es el h1 de MyPetsPage y tambien el encabezado de la seccion "Mis
 * mascotas" del perfil. Con esa asercion, montar el ProfilePage como destino
 * pasaba en verde: 22/22, medido. Solo se ponia roja con la ruta mala por un
 * motivo ACCIDENTAL (una ruta que no matchea desmonta todo), no por el que el
 * test dice verificar. Se afirma sobre la barra de pestañas, que es de
 * MyPetsPage y de nadie mas.
 */
function renderConDestino() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/profile']}>
        <Routes>
          <Route path="/profile" element={<ProfilePage />} />
          <Route path={MY_PETS_ROUTE} element={<MyPetsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function pet(overrides: Record<string, unknown>) {
  return {
    id: 'pet-1',
    name: 'Bruno',
    type: 'perro',
    status: 'registered',
    photos: [],
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ProfilePage', () => {
  beforeEach(() => {
    sendEmailOTP.mutateAsync = vi.fn();
    sendEmailOTP.isPending = false;
    authUser.current = {
      id: 'user-1',
      name: 'Carlos',
      email: 'carlos@example.com',
      is_verified: false,
      created_at: '',
    };
    petsData.mine = [];
    petsData.reported = [];
    verification.current = null;
    badgesData.current = [];
    refreshUser.mockClear();
    confirmEmailOTP.mutateAsync = vi.fn();
  });

  it('renderiza sin lanzar errores', () => {
    render(<ProfilePage />, { wrapper });
    expect(document.body).toBeTruthy();
  });

  // ── Verificación de email (comportamiento previo, intacto) ──

  // El 429 del cooldown venia sin `code`, asi que getErrorMessage caia en
  // unknown_error y el usuario leia un fallo generico. Y el boton quedaba
  // clickeable, invitando a repetir el pedido que el backend ya rechazo.
  it('muestra el mensaje del cooldown y arranca el contador con los segundos del servidor', async () => {
    sendEmailOTP.mutateAsync = vi.fn().mockRejectedValue(
      new ApiError('otp_cooldown', 429, 'otp_cooldown', 45)
    );

    render(<ProfilePage />, { wrapper });

    await userEvent.click(screen.getByText('profile:verifyEmail'));
    await userEvent.click(screen.getByText('profile:sendCode'));

    // El mensaje sale del `code`, no de un texto generico.
    expect(await screen.findByText('T(errors:otp_cooldown)')).toBeInTheDocument();
    // Y el contador arranca en lo que dijo el servidor, no en los 60 fijos. El
    // rango cubre el tick que corre mientras el test espera; lo que importa es
    // que sean cuarenta y pico y no sesenta.
    expect(screen.getByText(/^profile:resendIn:4\d$/)).toBeInTheDocument();
  });

  // El tope diario se cuenta en horas: un contador segundo a segundo durante 20
  // horas seria ruido, asi que ese caso solo muestra el mensaje.
  it('con el tope diario muestra el mensaje pero NO arranca contador', async () => {
    sendEmailOTP.mutateAsync = vi.fn().mockRejectedValue(
      new ApiError('otp_daily_limit', 429, 'otp_daily_limit', 72000)
    );

    render(<ProfilePage />, { wrapper });

    await userEvent.click(screen.getByText('profile:verifyEmail'));
    await userEvent.click(screen.getByText('profile:sendCode'));

    expect(await screen.findByText('T(errors:otp_daily_limit)')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText(/^profile:resendIn:/)).not.toBeInTheDocument();
    });
  });

  // Reenviar acuna un codigo nuevo y RETIRA el anterior, asi que lo que quedo
  // tipeado ya no puede matchear: enviarlo quema uno de los 5 intentos y
  // devuelve "invalido" sin explicar nada. Mismo defecto que ya se cerro en la
  // recuperacion de contrasena (8155d1c) y seguia abierto aca.
  it('al reenviar vacia el codigo viejo del input', async () => {
    // Un cooldown de 1s es la via barata de llegar al paso de confirmacion con un
    // contador que expira solo: el boton de reenviar solo existe en cero.
    sendEmailOTP.mutateAsync = vi.fn().mockRejectedValue(
      new ApiError('otp_cooldown', 429, 'otp_cooldown', 1)
    );

    render(<ProfilePage />, { wrapper });

    await userEvent.click(screen.getByText('profile:verifyEmail'));
    await userEvent.click(screen.getByText('profile:sendCode'));

    const input = await screen.findByPlaceholderText('000000');
    await userEvent.type(input, '123456');
    expect(input).toHaveValue('123456');

    // El reenvio ahora SI acuna: es el unico camino que invalida lo tipeado.
    sendEmailOTP.mutateAsync = vi.fn().mockResolvedValue(undefined);
    const resend = await screen.findByText('profile:resendCode', {}, { timeout: 3000 });
    await userEvent.click(resend);

    await waitFor(() => expect(input).toHaveValue(''));
  });

  // ── Rediseño ──

  // `created_at` es `string`, no `string | undefined`: una cadena vacia o basura
  // produce `Invalid Date`, y `toLocaleDateString` la imprime tal cual. Sin la
  // guarda el usuario lee literalmente "Miembro desde Invalid Date".
  it('no imprime "Invalid Date" cuando created_at no sirve', () => {
    authUser.current = { ...authUser.current, created_at: 'no-es-una-fecha' };
    render(<ProfilePage />, { wrapper });

    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^profile:memberSince/)).not.toBeInTheDocument();
  });

  it('con created_at valido muestra el mes y el año', () => {
    authUser.current = { ...authUser.current, created_at: '2026-03-15T10:00:00Z' };
    render(<ProfilePage />, { wrapper });

    expect(screen.getByText(/^profile:memberSince:marzo de 2026/)).toBeInTheDocument();
  });

  // El formulario vive detras del boton "Editar", como en el diseño. Si el
  // toggle deja de abrirlo, el usuario pierde la unica via de cambiar su nombre
  // o su telefono — y la pantalla sigue viendose sana.
  it('el formulario de edicion esta detras del boton Editar', async () => {
    render(<ProfilePage />, { wrapper });

    expect(screen.queryByLabelText(/^profile:name/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('profile:edit'));
    expect(screen.getByLabelText(/^profile:name/)).toBeInTheDocument();

    await userEvent.click(screen.getByText('common:cancel'));
    expect(screen.queryByLabelText(/^profile:name/)).not.toBeInTheDocument();
  });

  // El corte owned/adoption sale de `splitOwnedPets`, la misma definicion que usa
  // MyPetsPage. Una mascota en adopcion NO puede aparecer en "Mis mascotas".
  it('separa las mascotas en adopcion de las propias', () => {
    petsData.mine = [
      pet({ id: 'p1', name: 'Bruno', status: 'registered' }),
      pet({ id: 'p2', name: 'Luna', status: 'adoption' }),
    ];
    render(<ProfilePage />, { wrapper });

    // Las dos se ven, pero cada una en su seccion.
    expect(screen.getByText('Bruno')).toBeInTheDocument();
    expect(screen.getByText('Luna')).toBeInTheDocument();
    expect(screen.getByText('adoption:profile.tab')).toBeInTheDocument();
    // Y la de adopcion no se cuela en la grilla de propias: si lo hiciera,
    // apareceria dos veces.
    expect(screen.getAllByText('Luna')).toHaveLength(1);
  });

  // Una seccion vacia permanente es ruido. Sin reportes ni adopciones, sus
  // encabezados no existen.
  it('oculta reportes y adopcion cuando no hay ninguno', () => {
    render(<ProfilePage />, { wrapper });

    expect(screen.queryByText('pets:reports.tabReported')).not.toBeInTheDocument();
    expect(screen.queryByText('adoption:profile.tab')).not.toBeInTheDocument();
    // "Mis mascotas" SI se queda, con su llamada a publicar la primera.
    expect(screen.getByText('pets:mine.empty')).toBeInTheDocument();
  });

  // Un logro pendiente se muestra en gris con COMO conseguirlo: un tablero que
  // solo lista lo ya obtenido no dice que hacer despues.
  it('muestra los logros no obtenidos con su proximo objetivo', () => {
    render(<ProfilePage />, { wrapper });

    expect(screen.getByText('badges:first_helper.label')).toBeInTheDocument();
    expect(screen.getByText('badges:first_helper.howToEarn')).toBeInTheDocument();
  });

  // El "ver todas" solo aparece cuando hay mas de las que entran, y lleva
  // `aria-label` propio porque las tres secciones repiten el mismo texto
  // visible (WCAG 2.4.4).
  it('el "ver todas" aparece solo al pasarse del tope y se distingue por su nombre accesible', () => {
    petsData.mine = [1, 2, 3, 4, 5].map((i) =>
      pet({ id: `p${i}`, name: `Mascota ${i}`, status: 'registered' }),
    );
    render(<ProfilePage />, { wrapper });

    expect(screen.getByLabelText('profile:viewAllPets')).toBeInTheDocument();
    // El tope corta en cuatro: la quinta no se dibuja.
    expect(screen.queryByText('Mascota 5')).not.toBeInTheDocument();
  });

  // Verificado ya lo dice el distintivo de la tarjeta de perfil. Dejar además la
  // sección de verificación dibujaba el mismo dato dos veces en la misma columna
  // y sin ninguna acción detrás.
  it('con la cuenta verificada la seccion de verificacion no se dibuja', () => {
    verification.current = { is_verified: true };
    render(<ProfilePage />, { wrapper });

    expect(screen.queryByText('profile:accountVerification')).not.toBeInTheDocument();
  });

  it('sin verificar, la seccion de verificacion sigue estando', () => {
    verification.current = { is_verified: false };
    render(<ProfilePage />, { wrapper });

    expect(screen.getByText('profile:accountVerification')).toBeInTheDocument();
    expect(screen.getByText('profile:verifyEmail')).toBeInTheDocument();
  });

  // NO se afirma el `href`: se hace click y se exige que ALGO se renderice del
  // otro lado. Afirmar el string pasaba en verde con los tres links apuntando a
  // `/my-pets`, una ruta que no existe — pantalla en blanco, 0 caracteres.
  it('el "ver todas" de reportes ATERRIZA en la pantalla, y en su pestaña', async () => {
    petsData.reported = [1, 2, 3, 4, 5].map((i) =>
      pet({ id: `r${i}`, name: `Reporte ${i}`, status: 'stray' }),
    );
    renderConDestino();

    await userEvent.click(screen.getByLabelText('profile:viewAllReports'));

    // El destino existe...
    expect(await screen.findByRole('button', { name: 'pets:reports.tabOwned' })).toBeInTheDocument();
    // ...y abrió en la pestaña que el nombre accesible prometía.
    expect(screen.getByText('Reporte 1')).toBeInTheDocument();
  });

  it('el "ver todas" de adopción ATERRIZA en la pantalla, y en su pestaña', async () => {
    petsData.mine = [1, 2, 3, 4, 5].map((i) =>
      pet({ id: `a${i}`, name: `Adopción ${i}`, status: 'adoption' }),
    );
    renderConDestino();

    await userEvent.click(screen.getByLabelText('profile:viewAllAdoption'));

    expect(await screen.findByRole('button', { name: 'pets:reports.tabOwned' })).toBeInTheDocument();
    expect(screen.getByText('Adopción 1')).toBeInTheDocument();
  });

  it('el "ver todas" de mis mascotas ATERRIZA en la pantalla', async () => {
    petsData.mine = [1, 2, 3, 4, 5].map((i) =>
      pet({ id: `m${i}`, name: `Mascota ${i}`, status: 'registered' }),
    );
    renderConDestino();

    await userEvent.click(screen.getByLabelText('profile:viewAllPets'));

    expect(await screen.findByRole('button', { name: 'pets:reports.tabOwned' })).toBeInTheDocument();
  });

  // Al ocultar la sección de verificación con la cuenta ya verificada, el único
  // acuse de recibo pasó a ser el distintivo de la tarjeta, que lee
  // `user.is_verified` del AuthContext — `useState`, NO React Query. El
  // `invalidateQueries(['me'])` del hook no lo toca. Sin `refreshUser()`,
  // confirmar el código hacía desaparecer la sección sin que apareciera el
  // distintivo: verificarse quedaba en silencio absoluto hasta recargar.
  it('al confirmar el código refresca el usuario, o verificarse queda en silencio', async () => {
    confirmEmailOTP.mutateAsync = vi.fn().mockResolvedValue(undefined);
    sendEmailOTP.mutateAsync = vi.fn().mockResolvedValue(undefined);
    verification.current = { is_verified: false };

    render(<ProfilePage />, { wrapper });

    await userEvent.click(screen.getByText('profile:verifyEmail'));
    await userEvent.click(screen.getByText('profile:sendCode'));
    await userEvent.type(await screen.findByPlaceholderText('000000'), '123456');
    await userEvent.click(screen.getByText('profile:confirmCode'));

    await waitFor(() => expect(confirmEmailOTP.mutateAsync).toHaveBeenCalledWith('123456'));
    expect(refreshUser).toHaveBeenCalled();
  });

  // La grilla recorre BADGE_META, que es una constante compilada en el front. Un
  // logro que el backend otorgue antes de que shared/types lo conozca no tendría
  // dónde salir: el usuario se lo gana y no lo ve nunca.
  it('muestra un logro obtenido aunque el front no conozca su tipo', () => {
    badgesData.current = [
      { id: 'b1', badge_type: 'septimo_logro', earned_at: '2026-08-01T00:00:00Z' },
    ];
    render(<ProfilePage />, { wrapper });

    expect(screen.getByText('septimo_logro')).toBeInTheDocument();
  });

  // `ownedPets` excluye adopción, así que a quien tiene TODAS sus mascotas en
  // adopción le decía "todavía no publicaste ninguna" con la sección "En
  // adopción" listándolas justo abajo. Un estado vacío desmentido por otra
  // sección de la misma pantalla (mismo defecto que el wizard de /publish).
  it('no dice "no publicaste ninguna mascota" si tiene todas en adopción', () => {
    petsData.mine = [pet({ id: 'a1', name: 'Nube', status: 'adoption' })];
    render(<ProfilePage />, { wrapper });

    expect(screen.queryByText('pets:mine.empty')).not.toBeInTheDocument();
    expect(screen.getByText('profile:allInAdoption')).toBeInTheDocument();
    // Y la sección que lo desmentía sigue estando, con la mascota adentro.
    expect(screen.getByText('Nube')).toBeInTheDocument();
  });

  it('sin ninguna mascota sí muestra el estado vacío de siempre', () => {
    render(<ProfilePage />, { wrapper });

    expect(screen.getByText('pets:mine.empty')).toBeInTheDocument();
    expect(screen.queryByText('profile:allInAdoption')).not.toBeInTheDocument();
  });

  // El botón del avatar sigue vivo con el formulario abierto, y su éxito llama
  // `refreshUser()`. El efecto que sincroniza desde el servidor pisaba lo
  // tipeado, sin decir nada. Con un modo de edición explícito cuyo contrato es
  // "cancelar = deshacer", que otra cosa borre los campos es pérdida de datos.
  it('un refresh del usuario NO pisa lo que se está tipeando en el formulario', async () => {
    const { rerender } = render(<ProfilePage />, { wrapper });

    await userEvent.click(screen.getByText('profile:edit'));
    const nombre = screen.getByLabelText(/^profile:name/);
    await userEvent.clear(nombre);
    await userEvent.type(nombre, 'Carlos Editado');

    // Llega un `user` nuevo desde el servidor (lo que hace subir el avatar).
    authUser.current = { ...authUser.current, profile_photo_url: 'https://x/y.jpg' };
    rerender(<ProfilePage />);

    expect(nombre).toHaveValue('Carlos Editado');
  });

  it('sin pasarse del tope no hay "ver todas"', () => {
    petsData.mine = [pet({ id: 'p1', name: 'Bruno', status: 'registered' })];
    render(<ProfilePage />, { wrapper });

    expect(screen.queryByLabelText('profile:viewAllPets')).not.toBeInTheDocument();
  });

  // ── Miniaturas ───────────────────────────────────────────────────────────
  // El perfil dibuja TRES imagenes de tamanios muy distintos con la misma foto
  // de origen: la tarjeta de mascota (h-40), la fila compacta (h-14) y el avatar
  // (h-28). Servir la de 1200 en las tres es el gasto que estos guards cierran.
  describe('miniaturas', () => {
    const FOTO =
      'https://res.cloudinary.com/dd0yz5yxb/image/upload/v1785290767/searchpet/pets/abc/foto.webp';

    it('la tarjeta de mascota pide la variante compact', () => {
      petsData.mine = [pet({ status: 'lost', photos: [{ url: FOTO }] })];
      render(<ProfilePage />, { wrapper });

      const img = screen.getByAltText('Bruno') as HTMLImageElement;
      // compact y NO feed: la caja es h-40, no h-48.
      expect(img.src).toContain('w_600,h_240,c_lfill,g_auto');
    });

    it('la fila compacta pide 112, el doble de sus 56 css', () => {
      // Estaba cubierta solo por el test generico de c_lfill, que pasa con
      // CUALQUIER tamanio — la misma clase de hueco que dejo pasar el px del
      // podio, un piso mas abajo.
      petsData.reported = [pet({ id: 'p9', name: 'Fila', status: 'stray', photos: [{ url: FOTO }] })];

      const { container } = render(<ProfilePage />, { wrapper });

      const srcs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src') || '');
      expect(srcs.some((s) => s.includes('w_112,h_112,c_lfill'))).toBe(true);
    });

    it('el avatar pide 224, el doble de sus 112 css', () => {
      authUser.current = { ...authUser.current, profile_photo_url: FOTO };
      const { container } = render(<ProfilePage />, { wrapper });

      const srcs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src') || '');
      expect(srcs.some((s) => s.includes('w_224,h_224,c_lfill'))).toBe(true);
    });

    it('ninguna foto de Cloudinary se sirve sin transformar', () => {
      // El guard que de verdad importa: no enumera tamanios, exige que NINGUNA
      // quede cruda. Una imagen nueva que alguien agregue sin miniatura cae aca
      // sin que haya que acordarse de sumarle su propia asercion.
      authUser.current = { ...authUser.current, profile_photo_url: FOTO };
      petsData.mine = [pet({ status: 'lost', photos: [{ url: FOTO }] })];
      petsData.reported = [pet({ id: 'pet-2', name: 'Mia', status: 'stray', photos: [{ url: FOTO }] })];

      const { container } = render(<ProfilePage />, { wrapper });

      const cloudinarias = [...container.querySelectorAll('img')]
        .map((i) => i.getAttribute('src') || '')
        .filter((s) => s.includes('res.cloudinary.com'));

      expect(cloudinarias.length).toBeGreaterThan(0);
      expect(cloudinarias.every((s) => s.includes('c_lfill'))).toBe(true);
    });
  });
});
