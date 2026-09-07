import { useI18n } from '@app/i18n/useI18n';

/** 한국어 / EN button group. The pressed button is the current UI language. */
export function LangToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <span className="seg" role="group" aria-label={t('lang.aria')} data-testid="lang-toggle">
      <button type="button" className={`seg-btn${lang === 'ko' ? ' on' : ''}`} aria-pressed={lang === 'ko'} onClick={() => setLang('ko')} data-testid="lang-ko" lang="ko">
        {t('lang.ko')}
      </button>
      <button type="button" className={`seg-btn${lang === 'en' ? ' on' : ''}`} aria-pressed={lang === 'en'} onClick={() => setLang('en')} data-testid="lang-en" lang="en">
        {t('lang.en')}
      </button>
    </span>
  );
}
