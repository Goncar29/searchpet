/**
 * Las rutas que se enlazan desde más de un lugar.
 *
 * Existe por un defecto concreto: el rediseño del perfil enlazó "Ver todas" a
 * `/my-pets`, que **no es una ruta de esta app** — la real es `/pets/mine`. No
 * hay `path="*"`, así que React Router no matcheaba nada y la página quedaba en
 * blanco: medido, 0 caracteres renderizados contra 417 de la ruta buena.
 *
 * Lo que dejó pasar el defecto no fue el typo sino el test, que afirmaba el
 * `href` — o sea el string que yo mismo había tipeado— en vez del destino. Un
 * `toHaveAttribute('href', ...)` pasa igual de contento con una ruta que no
 * existe. Es la misma forma que la regla #53: una aserción que también se
 * cumple cuando lo que debía verificarse nunca ocurrió.
 *
 * Con la constante, el test del perfil arma el link Y monta el destino desde la
 * MISMA fuente que `App.tsx`, así que un rename rompe el test en vez de
 * producir otra pantalla en blanco.
 */
export const MY_PETS_ROUTE = '/pets/mine';

/** La pestaña con la que abre "Mis mascotas" (ver `initialTab` en esa página). */
export const myPetsRoute = (tab?: 'owned' | 'reported' | 'adoption') =>
  tab ? `${MY_PETS_ROUTE}?tab=${tab}` : MY_PETS_ROUTE;
