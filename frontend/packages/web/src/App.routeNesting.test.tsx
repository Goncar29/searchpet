import { describe, it, expect } from 'vitest';
import type { ReactElement } from 'react';
import App from './App';
import { MainLayout } from './layouts/MainLayout';

/**
 * Guard para el invariante del que dependen ChatPage y MessagesPage desde
 * T2: sus onMessage dejaron de invalidar `chat_message` por su cuenta porque
 * `MainLayout` ya invalida el PREFIJO `['messages']` para cualquier pantalla
 * montada bajo el — pero eso solo es cierto si esas rutas SIGUEN colgando de
 * `<Route element={<MainLayout />}>` en App.tsx. Si algun dia una de las dos
 * se moviera afuera (por accidente, en un merge, al reorganizar rutas), las
 * dos pantallas dejarian de refrescarse ante un chat_message EN SILENCIO: no
 * hay error, no hay warning, solo una lista/hilo que deja de actualizarse.
 * Este test existe para que ese movimiento rompa algo con nombre en vez de
 * romper algo en produccion.
 *
 * NO renderiza la app (nada de DOM, nada de mockear AuthContext, ThemeContext,
 * QueryClientProvider ni las ~40 paginas que importa App.tsx). `App` es una
 * funcion sin hooks propios, asi que llamarla directamente arma el arbol de
 * elementos que `<Routes>`/`<Route>` leen como configuracion — los MISMOS
 * objetos que usa react-router en produccion, no una copia de la tabla de
 * rutas hecha a mano que podria desincronizarse de ella. Los componentes de
 * pagina (HomePage, ChatPage, etc.) nunca se ejecutan: `<Route element={<X />}>`
 * solo crea un objeto descriptor via `React.createElement`, y React no invoca
 * el cuerpo de `X` hasta que algo la RENDERIZA de verdad, cosa que este test
 * nunca hace. Es bastante menos fragil que montar el router completo con
 * cada provider stubeado solo para probar que dos `path` viven bajo el mismo
 * `element` padre.
 */

// El `children` de un elemento JSX puede ser un solo elemento, un array, o
// (mas raro) algo falsy; normalizarlo a un array plano antes de recorrer.
function toArray(children: unknown): ReactElement[] {
  if (children == null) return [];
  const arr = Array.isArray(children) ? children : [children];
  return arr.filter(
    (c): c is ReactElement => Boolean(c) && typeof c === 'object' && 'props' in (c as object),
  );
}

/** True si `path` aparece en algun Route de este subarbol, a cualquier profundidad. */
function subtreeHasPath(node: ReactElement, path: string): boolean {
  const props = node.props as { path?: string; children?: unknown };
  if (props.path === path) return true;
  return toArray(props.children).some((child) => subtreeHasPath(child, path));
}

/** Cuantos Route de este subarbol declaran `path`, a cualquier profundidad. */
function countPath(node: ReactElement, path: string): number {
  const props = node.props as { path?: string; children?: unknown };
  const own = props.path === path ? 1 : 0;
  return own + toArray(props.children).reduce((n, child) => n + countPath(child, path), 0);
}

/** Encuentra el `<Route element={<MainLayout />}>`, a cualquier profundidad. */
function findMainLayoutRoute(node: ReactElement): ReactElement | null {
  const props = node.props as { element?: ReactElement; children?: unknown };
  if (props.element && (props.element as ReactElement).type === MainLayout) return node;
  for (const child of toArray(props.children)) {
    const found = findMainLayoutRoute(child);
    if (found) return found;
  }
  return null;
}

describe('App — nesting de rutas bajo MainLayout', () => {
  it('/messages y /messages/:userId cuelgan de <Route element={<MainLayout />}>', () => {
    const tree = (App as () => ReactElement)();
    const mainLayoutRoute = findMainLayoutRoute(tree);

    expect(mainLayoutRoute).not.toBeNull();
    expect(subtreeHasPath(mainLayoutRoute!, '/messages')).toBe(true);
    expect(subtreeHasPath(mainLayoutRoute!, '/messages/:userId')).toBe(true);
  });

  // Que aparezcan bajo MainLayout no alcanza: un duplicado del mismo `path`
  // declarado AFUERA podria matchear primero, y esa pantalla quedaria sin
  // MainLayout — o sea sin nadie que invalide ante chat_message. Cada ruta
  // tiene que existir UNA sola vez en todo el arbol, y esa vez adentro.
  it('/messages y /messages/:userId no estan declaradas en ningun otro lado', () => {
    const tree = (App as () => ReactElement)();
    const mainLayoutRoute = findMainLayoutRoute(tree)!;

    for (const path of ['/messages', '/messages/:userId']) {
      expect({ path, total: countPath(tree, path) }).toEqual({ path, total: 1 });
      expect({ path, underMainLayout: countPath(mainLayoutRoute, path) }).toEqual({ path, underMainLayout: 1 });
    }
  });
});
