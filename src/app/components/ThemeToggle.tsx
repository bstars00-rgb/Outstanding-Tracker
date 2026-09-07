import { useI18n } from '@app/i18n/useI18n';
import { useTheme } from '@app/theme/useTheme';
import { IconMoon, IconSun } from './Icons';

/** Light/dark switch: shows the current theme; the accessible name describes the action. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { t } = useI18n();
  const dark = theme === 'dark';
  const action = dark ? t('theme.switchToLight') : t('theme.switchToDark');
  return (
    <button type="button" className="btn small theme-toggle" onClick={toggle} aria-label={action} title={action} aria-pressed={dark} data-testid="theme-toggle" data-theme-value={theme}>
      {dark ? <IconMoon width={13} height={13} /> : <IconSun width={13} height={13} />}
      <span>{dark ? t('theme.dark') : t('theme.light')}</span>
    </button>
  );
}
