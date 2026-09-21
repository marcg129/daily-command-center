const EXPECTED_REDIRECT = "https://command.coreyg.dev/api/auth/workos/callback";

function fail(message) {
  console.error(`WorkOS staging config invalid: ${message}`);
  process.exit(1);
}

function required(name) {
  const value = process.env[name]?.trim() ?? "";
  if (!value) fail(`${name} is required`);
  return value;
}

const clientId = required("WORKOS_CLIENT_ID");
const apiKey = required("WORKOS_API_KEY");
const redirectUri = required("WORKOS_REDIRECT_URI");
const issuer = required("WORKOS_ISSUER");
const jwksUrl = required("WORKOS_JWKS_URL");

if (!/^client_[A-Za-z0-9_-]{8,120}$/.test(clientId)) {
  fail("WORKOS_CLIENT_ID has an unexpected format");
}
if (!/^sk_[A-Za-z0-9_-]{8,}$/.test(apiKey)) {
  fail("WORKOS_API_KEY has an unexpected format");
}

let redirect;
let issuerUrl;
let jwks;
try {
  redirect = new URL(redirectUri);
  issuerUrl = new URL(issuer);
  jwks = new URL(jwksUrl);
} catch {
  fail("one or more URL bindings are invalid");
}

if (redirect.toString() !== EXPECTED_REDIRECT) {
  fail(`WORKOS_REDIRECT_URI must be exactly ${EXPECTED_REDIRECT}`);
}
if (
  issuerUrl.protocol !== "https:" ||
  issuerUrl.origin !== "https://api.workos.com" ||
  issuerUrl.search ||
  issuerUrl.hash
) {
  fail("WORKOS_ISSUER must use https://api.workos.com");
}
const issuerPath = issuerUrl.pathname.replace(/\/$/, "");
const allowedIssuerPaths = new Set(["", `/user_management/${clientId}`]);
if (!allowedIssuerPaths.has(issuerPath)) {
  fail("WORKOS_ISSUER does not match the configured client");
}

const expectedJwks = `https://api.workos.com/sso/jwks/${clientId}`;
if (jwks.toString().replace(/\/$/, "") !== expectedJwks) {
  fail(`WORKOS_JWKS_URL must be ${expectedJwks}`);
}

console.log("WorkOS staging configuration is structurally ready.");
console.log(`Client ID: ${clientId}`);
console.log(`Redirect URI: ${redirect.toString()}`);
console.log(`Issuer: ${issuerUrl.toString()}`);
console.log(`JWKS URL: ${jwks.toString()}`);
console.log("API key: configured (value intentionally not displayed)");
