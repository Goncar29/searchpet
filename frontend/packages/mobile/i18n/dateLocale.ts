/**
 * Reexport del helper compartido.
 *
 * La implementación se movió a `shared/utils/dateLocale.ts` cuando se descubrió
 * que web había derivado a tres formas distintas de formatear fechas por no
 * tener este mapa. Se conserva este archivo para no tocar los siete call sites
 * de mobile, que siguen importando desde `i18n/dateLocale`.
 */
export { getDateLocale } from '@shared/utils/dateLocale';
