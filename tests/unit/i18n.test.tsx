import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

afterEach(cleanup);
import { MemoryRouter } from 'react-router-dom';
import { buildMockModel, type MockBuild } from '@app/data/mock-model';
import { TrackerContext, readyContextValue } from '@app/data/TrackerContext';
import { Layout } from '@app/components/Layout';
import { I18nProvider, LANG_STORAGE_KEY, resolveInitialLang } from '@app/i18n/useI18n';
import { STRINGS, translate } from '@app/i18n/strings';

let built: MockBuild;

beforeAll(async () => {
  built = await buildMockModel('2026-09-05');
});

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = '';
  document.documentElement.removeAttribute('lang');
});

function renderLayout(initialLang?: 'en' | 'ko') {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <I18nProvider initialLang={initialLang}>
        <TrackerContext.Provider value={readyContextValue(built.model, built.insight)}>
          <Layout>
            <div>page</div>
          </Layout>
        </TrackerContext.Provider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe('i18n', () => {
  it('has a Korean translation for every English key', () => {
    const enKeys = Object.keys(STRINGS.en).sort();
    const koKeys = Object.keys(STRINGS.ko).sort();
    expect(koKeys).toEqual(enKeys);
    for (const k of enKeys) expect((STRINGS.ko as Record<string, string>)[k].length, k).toBeGreaterThan(0);
  });

  it('fills template variables', () => {
    expect(translate('en', 'customers.summary', { shown: 3, total: 10, sort: 'Risk score', dir: 'desc' })).toBe('Showing 3 of 10 customers · sorted by Risk score (desc)');
    expect(translate('ko', 'col.outstandingRep', { ccy: 'JPY' })).toBe('미수금 (JPY)');
  });

  it('toggling the language switches the nav labels and updates <html lang>', () => {
    renderLayout('en');
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(nav).toHaveTextContent('Overview');
    expect(nav).toHaveTextContent('Customers');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
    expect(screen.getByTestId('lang-toggle')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('lang-ko'));
    const navKo = screen.getByRole('navigation', { name: '주 메뉴' });
    expect(navKo).toHaveTextContent('요약');
    expect(navKo).toHaveTextContent('고객사');
    expect(navKo).not.toHaveTextContent('Customers');
    expect(document.documentElement.getAttribute('lang')).toBe('ko');
    expect(window.localStorage.getItem(LANG_STORAGE_KEY)).toBe('ko');
    expect(screen.getByTestId('mode-badge')).toHaveTextContent('MOCK DATA');
    expect(screen.getAllByText('보고 통화', { exact: false }).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('lang-en'));
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toHaveTextContent('Overview');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });

  it('resolves the initial language from the hash query, then localStorage, then the browser', () => {
    window.location.hash = '#/?mode=mock&lang=ko';
    expect(resolveInitialLang()).toBe('ko');
    expect(window.localStorage.getItem(LANG_STORAGE_KEY)).toBe('ko');

    window.location.hash = '#/customers';
    expect(resolveInitialLang()).toBe('ko'); // persisted

    window.localStorage.clear();
    expect(resolveInitialLang()).toBe(navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en');
  });

  it('shows the model language in the footer', () => {
    renderLayout('en');
    expect(screen.getByTestId('model-lang')).toHaveTextContent(built.model.lang);
  });
});
