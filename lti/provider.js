import { Provider } from 'ltijs';

// LTI-Provider initialisieren
export const lti = new Provider(process.env.LTI_KEY);

// Einrichtung des LTI-Providers
await lti.setup(process.env.LTI_DB, {
  appRoute: '/lti',
  loginRoute: '/login',
  keysetRoute: '/keys'
});