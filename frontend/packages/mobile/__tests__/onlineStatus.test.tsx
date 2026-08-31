import React from 'react';
import NetInfo from '@react-native-community/netinfo';
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

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

function conQueryClient() {
  // `gcTime: 0` no es cosmético. Al desmontar, React Query programa el barrido
  // de la query con un timer de `gcTime` (5 min por default), y ese timer queda
  // vivo después del test: jest imprime "did not exit one second after the test
  // run has completed" y el proceso NO termina. Local es una molestia; en CI el
  // job se cuelga hasta que lo mata el `timeout-minutes`.
  clienteEnUso = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const client = clienteEnUso;
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
