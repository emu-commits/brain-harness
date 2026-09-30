import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { StoreProvider } from './store';
import { SessionProvider } from './session';
import { ToastProvider } from './toast';
import { browserClock, browserIds } from './env';
import { DexieStorage, GoalGraphDB } from '../data/db';
import './styles/app.css';

const storage = new DexieStorage(new GoalGraphDB());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <ToastProvider>
        <StoreProvider storage={storage} clock={browserClock} ids={browserIds}>
          <SessionProvider>
            <App />
          </SessionProvider>
        </StoreProvider>
      </ToastProvider>
    </HashRouter>
  </StrictMode>,
);
