import { useTranslation } from 'react-i18next';

export type ShelterStepKey = 'data' | 'review' | 'live';

const STEPS: { key: ShelterStepKey; titleKey: string; bodyKey: string }[] = [
  { key: 'data', titleKey: 'shelters:register.step1Title', bodyKey: 'shelters:register.step1Body' },
  { key: 'review', titleKey: 'shelters:register.step2Title', bodyKey: 'shelters:register.step2Body' },
  { key: 'live', titleKey: 'shelters:register.step3Title', bodyKey: 'shelters:register.step3Body' },
];

// ShelterSteps renders the 3-step publication path. With `active` it works as a
// status stepper (MyShelterPage); without it, as the neutral "how it works"
// list (RegisterShelterPage step 0). Same steps in both places by design.
export function ShelterSteps({ active }: { active?: ShelterStepKey }) {
  const { t } = useTranslation(['shelters']);

  return (
    <ol className="space-y-3">
      {STEPS.map((step, i) => {
        const isActive = active === step.key;
        return (
          <li
            key={step.key}
            className={`flex gap-3 rounded-xl border p-4 ${
              isActive
                ? 'border-primary bg-orange-50 dark:bg-orange-950'
                : 'border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900'
            }`}
          >
            <span
              className={`flex-shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-sm font-bold ${
                isActive ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
              }`}
            >
              {i + 1}
            </span>
            <div>
              <p className="font-semibold text-gray-900 dark:text-gray-100">{t(step.titleKey)}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t(step.bodyKey)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
