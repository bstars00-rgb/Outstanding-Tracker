import type { ReactElement, ReactNode } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Lang } from '@core/i18n';
import { I18nProvider } from '@app/i18n/useI18n';
import { ThemeProvider, type Theme } from '@app/theme/useTheme';

interface ProviderOptions {
  lang?: Lang;
  theme?: Theme;
  /** Wrap in a MemoryRouter at this route (omit for components that do not use the router). */
  route?: string;
}

export function Providers({ children, lang = 'en', theme = 'light', route }: ProviderOptions & { children: ReactNode }) {
  const inner = (
    <ThemeProvider initialTheme={theme}>
      <I18nProvider initialLang={lang}>{children}</I18nProvider>
    </ThemeProvider>
  );
  return route ? <MemoryRouter initialEntries={[route]}>{inner}</MemoryRouter> : inner;
}

/** render() wrapped in the app providers (theme + i18n, optional router). */
export function renderWithProviders(ui: ReactElement, opts: ProviderOptions & Omit<RenderOptions, 'wrapper'> = {}) {
  const { lang, theme, route, ...rest } = opts;
  return render(ui, {
    wrapper: ({ children }) => (
      <Providers lang={lang} theme={theme} route={route}>
        {children}
      </Providers>
    ),
    ...rest,
  });
}
