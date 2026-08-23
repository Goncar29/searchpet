import type { ReactNode } from 'react';

interface FormSectionProps {
  /** Omit on a section that needs no heading — a lone context card, say. */
  title?: string;
  /**
   * Short chip on the right of the heading row, for "Optional".
   *
   * It is a chip and not "(optional)" appended to the heading because a section
   * groups several fields: appending it to the text would read as if only the
   * first one were optional.
   */
  badge?: string;
  children: ReactNode;
}

/**
 * One card of a form.
 *
 * Each section is its OWN card rather than a band inside one tall card. That is
 * what the Stitch design does, and it survives narrow screens better: a single
 * long card separated by hairlines collapses into an undifferentiated column on
 * a phone, while separate cards keep their grouping at any width.
 *
 * Padding is `p-6 sm:p-8` — the design's 32px, stepped down on small screens
 * where 32px on each side of a 390px viewport eats a sixth of the width.
 */
export function FormSection({ title, badge, children }: FormSectionProps) {
  return (
    <section className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 sm:p-8 shadow-sm">
      {title && (
        <div className="flex items-center justify-between gap-3 mb-6">
          <h2 className="font-display text-headline text-gray-900 dark:text-gray-50">{title}</h2>
          {badge && (
            <span className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
              {badge}
            </span>
          )}
        </div>
      )}
      {children}
    </section>
  );
}
