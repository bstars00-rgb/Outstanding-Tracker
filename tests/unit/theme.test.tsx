import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

afterEach(cleanup);
import { ThemeToggle } from '@app/components/ThemeToggle';
import { I18nProvider } from '@app/i18n/useI18n';
import { THEME_STORAGE_KEY, ThemeProvider, resolveInitialTheme } from '@app/theme/useTheme';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

function renderToggle(lang: 'en' | 'ko' = 'en') {
  return render(
    <ThemeProvider>
      <I18nProvider initialLang={lang}>
        <ThemeToggle />
      </I18nProvider>
    </ThemeProvider>,
  );
}

describe('theme', () => {
  it('defaults to light (no stored choice, jsdom has no prefers-color-scheme) and applies data-theme on <html>', () => {
    renderToggle();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(screen.getByTestId('theme-toggle')).toHaveTextContent('Light');
  });

  it('toggling sets data-theme="dark", persists it and flips the label', () => {
    renderToggle();
    const btn = screen.getByTestId('theme-toggle');
    fireEvent.click(btn);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(btn).toHaveTextContent('Dark');
    expect(btn).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(btn);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('honours a stored preference on the next mount and localises the label', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(resolveInitialTheme()).toBe('dark');
    renderToggle('ko');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByTestId('theme-toggle')).toHaveTextContent('다크');
  });
});
