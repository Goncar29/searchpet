import { NavLink, Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import type { IconName } from '../../components/Icon';

/**
 * Shell del panel de administración, con el lenguaje visual de Stitch
 * ("Dashboard de Administración" y "Gestión de Refugios").
 *
 * QUÉ SE ADOPTA: la barra lateral como superficie propia, con el bloque de
 * marca arriba y un ícono por sección.
 *
 * QUÉ NO, y por qué: la captura lista cinco items (Dashboard, Reports, Users,
 * Refuges, Settings) y la app tiene OCHO secciones reales. El nav refleja la
 * app y no el mockup — es el mismo criterio con el que el #162 descartó la
 * variante de Refugios que pedía conceptos inexistentes. Por lo mismo quedan
 * afuera "Settings", "Support" y el botón "New Report" de la captura: no hay
 * pantalla ni endpoint detrás de ninguno.
 *
 * El título del panel se va a la barra y NO se duplica en el contenido: las
 * ocho pantallas ya traen su propio `<h2>` con marcado idéntico, así que ese
 * `<h2>` pasa a ser el título de página que dibuja el diseño. Se mantiene la
 * jerarquía que ya existía (h1 del panel, h2 de la pantalla) en vez de
 * promover ocho encabezados, que es exactamente el cambio que dejaría a uno
 * desalineado si alguno no se migrara.
 */

const navLinks: { to: string; labelKey: string; icon: IconName }[] = [
  { to: '/admin/abuse-reports', labelKey: 'nav.abuseReports', icon: 'warning' },
  { to: '/admin/stories', labelKey: 'nav.stories', icon: 'description' },
  { to: '/admin/groups', labelKey: 'nav.groups', icon: 'campaign' },
  { to: '/admin/admins', labelKey: 'nav.admins', icon: 'person' },
  { to: '/admin/shelters', labelKey: 'nav.shelters', icon: 'home' },
  { to: '/admin/foster-homes', labelKey: 'nav.fosterHomes', icon: 'favorite' },
  { to: '/admin/impact', labelKey: 'nav.impact', icon: 'celebration' },
  { to: '/admin/vets', labelKey: 'nav.vets', icon: 'pets' },
];

export function AdminLayout() {
  const { t } = useTranslation('admin');

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col md:flex-row md:gap-8">
        {/* En escritorio la barra es una superficie propia y pegajosa; en
            celular es una fila que envuelve, NO un panel colapsado detrás de un
            botón. Un `hidden` en el breakpoint chico dejaría las ocho secciones
            inalcanzables justo donde menos lugar hay para equivocarse. */}
        <aside className="md:w-60 md:flex-shrink-0 mb-6 md:mb-0">
          <div className="md:sticky md:top-24">
            <div className="mb-4 md:mb-6">
              {/* `font-semibold` explícito: `font-display` fija la FAMILIA y el
                  preflight de Tailwind v4 deja los h1-h6 en `font-weight:
                  inherit`, así que sin esto el título sale en peso normal. */}
              <h1 className="font-display font-semibold text-xl text-gray-900 dark:text-gray-100">
                {t('panel.title')}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('panel.subtitle')}</p>
            </div>

            <nav
              aria-label={t('panel.title')}
              className="flex flex-wrap gap-1 md:flex-col md:flex-nowrap md:gap-0.5 md:bg-white md:dark:bg-gray-900 md:rounded-2xl md:border md:border-gray-100 md:dark:border-gray-800 md:p-2"
            >
              {navLinks.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 text-sm font-medium py-2 px-3 rounded-lg transition-colors duration-150 whitespace-nowrap ${
                      isActive
                        ? 'text-primary bg-orange-50 dark:bg-orange-950'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`
                  }
                >
                  {/* El ícono es decoración: la etiqueta de al lado ya nombra el
                      destino, así que va `aria-hidden` (el default de `Icon`) y
                      un lector de pantalla lee sólo el texto, una vez. */}
                  <Icon name={link.icon} className="h-5 w-5 flex-shrink-0" />
                  {t(link.labelKey)}
                </NavLink>
              ))}
            </nav>
          </div>
        </aside>

        <div className="flex-1 min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
