// Only replace yours if it differs; keep YOUR existing tidecloak.json import path.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TideCloakContextProvider } from '@tidecloak/react';
import tidecloakConfig from '../tidecloak.json';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TideCloakContextProvider config={tidecloakConfig}>
      <App />
    </TideCloakContextProvider>
  </StrictMode>
);
