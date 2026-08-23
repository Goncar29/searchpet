import type { ReactNode } from 'react';
import { Icon, type IconName } from '../Icon';

interface FormPageProps {
  title: string;
  /** One or two lines under the title. Optional: short forms do not need it. */
  subtitle?: string;
  /** Decorative glyph above the title. Purely tone-setting — never the only carrier of meaning. */
  icon?: IconName;
  children: ReactNode;
}

/**
 * Page frame for a form built out of stacked `FormSection` cards.
 *
 * Two containers on purpose, and the nesting is the point:
 *
 * - The OUTER one is `max-w-7xl` with the padding inside it, which is the
 *   project-wide content width (rule #50) and keeps the page's left edge on the
 *   same x as the navbar logo.
 * - The INNER one caps the cards at `max-w-3xl` (768px). A single-column form
 *   stretched to 1216px is unreadable — the eye loses the label-to-input
 *   relationship — so the column stays narrow and centred inside a page that is
 *   still aligned with everything else. The Stitch mock does exactly this: wide
 *   page, narrow card column.
 *
 * No `min-h-screen` and no background here. `MainLayout` already wraps every
 * page in `min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950`
 * (MainLayout.tsx:117); repeating it nests a full viewport INSIDE a page that
 * also carries a navbar and a footer, which is the same defect `AuthLayout`
 * documents after measuring it on the auth screens.
 */
export function FormPage({ title, subtitle, icon, children }: FormPageProps) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
      <div className="max-w-3xl mx-auto">
        <header className="text-center mb-8">
          {icon && <Icon name={icon} className="mx-auto mb-4 block text-4xl text-primary" />}
          {/* The design's own mobile step. The pairing is the one documented in
              index.css: `display-sm` at small widths, `display` from md up. */}
          <h1 className="font-display text-display-sm md:text-display text-gray-900 dark:text-gray-50">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-3 text-gray-500 dark:text-gray-400 max-w-xl mx-auto">{subtitle}</p>
          )}
        </header>
        {children}
      </div>
    </div>
  );
}
