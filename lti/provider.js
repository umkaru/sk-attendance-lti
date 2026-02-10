const { Provider } = require('ltijs');

const lti = new Provider(
  process.env.LTI_KEY,
  {
    url: process.env.LTI_DB
  }
);

// LTI initialisieren und an Express hängen
function setupLTI(app) {
  lti.deploy({ app, server: false });

  lti.onConnect((token, req, res) => {
    res.send(`
      <h1>🎉 LTI Launch erfolgreich</h1>
      <p>Dieses Tool wurde von Canvas gestartet.</p>
    `);
  });
}

module.exports = setupLTI;