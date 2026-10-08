/**
 * The /login URL a route guard sends to, carrying where to come back to.
 *
 * Path AND query, encoded. Pet detail links to /reports/create?petId=…, and
 * with the path alone the user came back from login to a form with no pet
 * picked. Unencoded, a second `&param` would end the returnUrl and become a
 * parameter of /login instead.
 *
 * Shared by ProtectedRoute and AdminRoute on purpose: they used to build this
 * on their own, and AdminRoute dropped the returnUrl altogether. The other
 * end, LoginPage, still validates the value with safeReturnPath.
 */
export function loginRedirect(location: { pathname: string; search: string }): string {
  return `/login?returnUrl=${encodeURIComponent(location.pathname + location.search)}`;
}
