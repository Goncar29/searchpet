import type { ReactNode } from 'react';
import { Logo } from '../Logo';

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

/**
 * Page frame for the auth screens: centred logo, title and subtitle above the
 * content.
 *
 * The heading sits OUTSIDE the card on purpose. The two Stitch designs disagree
 * on this — "Iniciar Sesión" tucks the logo inside the card while "Crear Cuenta"
 * places it above — and porting each literally would make the card jump when a
 * user toggles between login and register, which is the most common click in
 * this flow. Register's arrangement won: it keeps the card shorter, which is
 * what fits above the fold on a phone.
 */
export function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-md mx-auto px-4 py-10 sm:py-16">
        <div className="text-center mb-8">
          <Logo className="h-14 w-14 mx-auto mb-4 text-primary" />
          <h1 className="font-display text-headline text-gray-900 dark:text-gray-100">{title}</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
