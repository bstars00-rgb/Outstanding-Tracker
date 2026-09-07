import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@app/App';
import { PasswordGate } from '@app/gate/PasswordGate';
import { I18nProvider } from '@app/i18n/useI18n';
import { ThemeProvider } from '@app/theme/useTheme';
import '@app/styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <PasswordGate>
          <App />
        </PasswordGate>
      </I18nProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
