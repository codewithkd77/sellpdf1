/**
 * App/Universal Link association files.
 *
 * Android reads:
 *   GET /.well-known/assetlinks.json
 *
 * iOS reads:
 *   GET /.well-known/apple-app-site-association
 *   GET /apple-app-site-association
 *
 * Values are env-driven so they can differ by environment/build:
 * - ANDROID_PACKAGE_NAME (default: com.example.sellpdf)
 * - ANDROID_SHA256_CERT_FINGERPRINTS (comma-separated list)
 * - IOS_APP_ID (recommended: <TEAM_ID>.<BUNDLE_ID>)
 */
const { Router } = require('express');

const router = Router();

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

router.get('/assetlinks.json', (_req, res) => {
  const packageName = process.env.ANDROID_PACKAGE_NAME || 'com.example.sellpdf';
  const fingerprints = parseCsv(process.env.ANDROID_SHA256_CERT_FINGERPRINTS);

  const body = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];

  // Must be JSON and publicly reachable over HTTPS.
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).send(body);
});

function appleAssociationBody() {
  const iosAppId = process.env.IOS_APP_ID || 'TEAMID.com.example.sellpdf';
  return {
    applinks: {
      apps: [],
      details: [
        {
          appID: iosAppId,
          paths: ['/share/product/*'],
        },
      ],
    },
  };
}

router.get('/apple-app-site-association', (_req, res) => {
  // iOS expects application/json without file extension.
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).send(appleAssociationBody());
});

module.exports = router;

