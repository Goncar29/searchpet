import React from 'react';
import { Text } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { act, render, renderHook, waitFor } from '@testing-library/react-native';

import { ListState } from '../components/list/ListState';
import sharedEs from '../../shared/i18n/locales/es.json';
import sharedEn from '../../shared/i18n/locales/en.json';
import sharedPt from '../../shared/i18n/locales/pt.json';
import mobileEs from '../i18n/locales/es.json';
import mobileEn from '../i18n/locales/en.json';
import mobilePt from '../i18n/locales/pt.json';

// Side-effect import: installing the bridge IS the whole module. Importing it
// is what registers the NetInfo subscription these tests then drive.
import '../utils/onlineStatus';

const addEventListener = NetInfo.addEventListener as unknown as jest.Mock;

// El mock oficial de netinfo nunca llama al listener, así que acá se maneja la
// conectividad del dispositivo a mano. Es la única forma de probar esta rama:
// en un test no hay radio que apagar.
function laRedPasaA(state: { isConnected: boolean | null; isInternetReachable?: boolean | null }) {
  const listener = addEventListener.mock.calls[0][0];
  act(() => listener(state));
}

let clienteEnUso: QueryClient | null = null;

function hacerCliente() {
  // `gcTime: 0` no es cosmético. Al desmontar, React Query programa el barrido
  // de la query con un timer de `gcTime` (5 min por default), y ese timer queda
  // vivo después del test: jest imprime "did not exit one second after the test
  // run has completed" y el proceso NO termina. Local es una molestia; en CI el
  // job se cuelga hasta que lo mata el `timeout-minutes`.
  clienteEnUso = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return clienteEnUso;
}

function conQueryClient() {
  const client = hacerCliente();
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  clienteEnUso?.clear();
  clienteEnUso = null;
});

describe('el puente entre NetInfo y onlineManager', () => {
  beforeEach(() => {
    onlineManager.setOnline(true);
  });

  it('se suscribe a NetInfo al importarse', () => {
    // Sin esto no hay emisor: React Query registra sus listeners de
    // `online`/`offline` sobre el polyfill de domEvents y nadie los despacha
    // nunca, así que `fetchStatus` jamás vale `'paused'`.
    expect(addEventListener).toHaveBeenCalledTimes(1);
  });

  it('un dispositivo desconectado deja a onlineManager offline', () => {
    laRedPasaA({ isConnected: false });

    expect(onlineManager.isOnline()).toBe(false);
  });

  it('vuelve a online cuando vuelve la red', () => {
    laRedPasaA({ isConnected: false });
    laRedPasaA({ isConnected: true });

    expect(onlineManager.isOnline()).toBe(true);
  });

  // ── La mitad que impide arreglar el bug al revés ──────────────────────
  //
  // Las tres de arriba se satisfacen leyendo `!!state.isConnected`, que es lo
  // que sugiere la doc de React Query. Estas dos son las que fijan la
  // dirección: ante la duda NO decimos que no hay conexión.
  it('un estado de red desconocido NO se lee como offline', () => {
    laRedPasaA({ isConnected: null });

    expect(onlineManager.isOnline()).toBe(true);
  });

  it('una sonda de alcance sin responder tampoco pausa nada', () => {
    laRedPasaA({ isConnected: true, isInternetReachable: null });

    expect(onlineManager.isOnline()).toBe(true);
  });
});

describe('lo que ve una query de verdad', () => {
  beforeEach(() => {
    onlineManager.setOnline(true);
  });

  it('montada sin red queda en isPaused — la rama que ListState dibuja', async () => {
    laRedPasaA({ isConnected: false });
    const queryFn = jest.fn().mockResolvedValue(['algo']);

    const { result } = renderHook(() => useQuery({ queryKey: ['probe'], queryFn }), {
      wrapper: conQueryClient(),
    });

    await waitFor(() => expect(result.current.fetchStatus).toBe('paused'));
    expect(result.current.isPaused).toBe(true);
    expect(queryFn).not.toHaveBeenCalled();
  });

  // Sin ésta, la de arriba también pasaría si las queries no corrieran nunca
  // — que es exactamente el modo de falla que este puente podría introducir.
  it('montada con red corre y trae los datos', async () => {
    const queryFn = jest.fn().mockResolvedValue(['algo']);

    const { result } = renderHook(() => useQuery({ queryKey: ['probe'], queryFn }), {
      wrapper: conQueryClient(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isPaused).toBe(false);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});

// ── El texto que realmente se lee, en los tres idiomas ───────────────────
//
// El arnés de pantallas NO inicializa i18next: ahí `t()` devuelve la clave, así
// que `expect(queryByText(/common:offlineTitle/))` pasa igual si esa clave no
// existe en ningún locale. Este bloque monta el ListState real contra los JSON
// reales.
//
// Y lo que hace el trabajo es comparar los TRES idiomas ENTRE SÍ, no cada uno
// contra `t()`. Con `fallbackLng: 'es'`, a un `pt.json` al que le falte
// `offlineTitle` i18next le devuelve el español: no hay clave cruda, no hay
// excepción, y una aserción contra `t()` pasa feliz porque `t()` está
// devolviendo esa misma traducción prestada. Lo único que delata el hueco es
// que portugués haya quedado idéntico a español. Un locale incompleto se ve
// perfecto justo en el idioma en el que se prueba.
describe('lo que lee el usuario cuando el puente dice que no hay red', () => {
  let i18n: typeof i18next;

  beforeAll(async () => {
    i18n = i18next.createInstance();
    await i18n.init({
      lng: 'es',
      fallbackLng: 'es',
      resources: {
        es: { ...sharedEs, ...mobileEs },
        en: { ...sharedEn, ...mobileEn },
        pt: { ...sharedPt, ...mobilePt },
      },
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
  });

  function Pantalla() {
    const query = useQuery({ queryKey: ['probe'], queryFn: async () => ['Firulais'] });
    return (
      <ListState query={query} loading={<Text>[esqueleto]</Text>}>
        {(items: string[]) => <Text>{`[lista: ${items.length}]`}</Text>}
      </ListState>
    );
  }

  function textoDe(json: unknown, out: string[] = []): string[] {
    if (json == null) return out;
    if (typeof json === 'string') return out.concat(json);
    if (Array.isArray(json)) return json.reduce<string[]>((acc, c) => textoDe(c, acc), out);
    return textoDe((json as { children?: unknown }).children, out);
  }

  async function cartelOfflineEn(lng: string) {
    await act(async () => { await i18n.changeLanguage(lng); });
    onlineManager.setOnline(true);
    laRedPasaA({ isConnected: false });

    const { toJSON, unmount } = render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={hacerCliente()}>
          <Pantalla />
        </QueryClientProvider>
      </I18nextProvider>,
    );
    await waitFor(() => expect(textoDe(toJSON()).join(' ')).not.toContain('esqueleto'));
    const partes = textoDe(toJSON());
    unmount();
    return partes;
  }

  it('cada idioma trae su propia copy, campo por campo', async () => {
    const porIdioma = new Map<string, string[]>();
    for (const lng of ['es', 'en', 'pt']) {
      porIdioma.set(lng, await cartelOfflineEn(lng));
    }

    for (const partes of porIdioma.values()) {
      // No es el estado vacío: la lista no se dibujó.
      expect(partes.join(' ')).not.toContain('[lista:');
      // Ninguna clave sin resolver (`common:offlineTitle` y familia).
      expect(partes.join(' ')).not.toMatch(/[a-z_]+:[a-zA-Z.]+/);
      expect(partes).toHaveLength(4);
    }

    // La aserción que protege los locales, y va CAMPO POR CAMPO — la escribí
    // primero sobre la tarjeta entera y pasó verde con `offlineTitle` borrado
    // de `pt.json`: si sólo un campo cae al fallback, los otros dos siguen en
    // portugués y las tres cadenas completas siguen difiriendo. Comparar el
    // total esconde exactamente el hueco que se quiere encontrar.
    //
    // El índice 0 se saltea a propósito: es el ⚠️, que no es texto traducible.
    for (const campo of [1, 2, 3]) {
      const valores = [...porIdioma.values()].map((partes) => partes[campo]);
      expect(new Set(valores).size).toBe(3);
    }
  });

  it('el cartel es ícono, título, cuerpo y botón — en ese orden', async () => {
    expect((await cartelOfflineEn('es')).join(' ')).toBe(
      '⚠️ Estás sin conexión No pudimos leer esta lista. Cuando vuelva la conexión, probá de nuevo. Reintentar',
    );
  });
});
