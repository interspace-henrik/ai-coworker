/**
 * Synthetic vocabulary for task titles and log lines. Everything here is invented:
 * no real customers, hosts, addresses, keys or advisories.
 */
export const VOCAB: Readonly<Record<string, readonly string[]>> = {
  project: [
    'atlas', 'harbor', 'nordlys', 'quartz', 'fjord', 'meridian', 'helix', 'lumen', 'cobalt',
    'tundra', 'orbit', 'sable', 'juniper', 'kestrel', 'basalt', 'aurora', 'vesta', 'polaris',
  ],
  service: [
    'billing-api', 'auth-service', 'search-gateway', 'notification-worker', 'inventory-api',
    'report-builder', 'media-proxy', 'checkout-api', 'user-profile', 'ledger-sync',
    'webhook-relay', 'catalog-indexer', 'scheduler', 'pricing-engine', 'session-store',
  ],
  table: [
    'invoices', 'orders', 'customers', 'line_items', 'payments', 'subscriptions', 'audit_log',
    'shipments', 'products', 'sessions', 'events', 'accounts', 'tickets', 'price_rules',
  ],
  column: [
    'customer_id', 'status', 'created_at', 'account_id', 'due_date', 'tenant_id', 'sku',
    'external_ref', 'updated_at', 'region_code',
  ],
  controller: [
    'InvoiceController', 'OrderController', 'CustomerController', 'PaymentController',
    'SubscriptionController', 'ReportController', 'WebhookController', 'AuthController',
  ],
  srcfile: [
    'src/billing/invoice.ts', 'app/Http/Controllers/OrderController.php', 'internal/queue/worker.go',
    'services/pricing/rules.py', 'src/components/Checkout.vue', 'app/Models/Subscription.php',
    'pkg/auth/token.go', 'src/api/routes/users.ts', 'lib/ledger/reconcile.rb',
    'src/search/ranker.py', 'app/Jobs/SendDigest.php', 'src/hooks/useCart.tsx',
  ],
  module: [
    'auth', 'billing', 'checkout', 'search', 'notifications', 'reporting', 'inventory',
    'onboarding', 'payments', 'catalog', 'permissions', 'exports',
  ],
  endpoint: [
    'GET /v2/invoices', 'POST /v2/orders', 'GET /v1/customers/{id}', 'PATCH /v2/subscriptions/{id}',
    'POST /v1/auth/token', 'GET /v2/reports/monthly', 'POST /v1/webhooks/dispatch',
    'GET /v2/catalog/search',
  ],
  package: [
    'lodash', 'axios', 'guzzlehttp/guzzle', 'symfony/http-foundation', 'express', 'pydantic',
    'requests', 'golang.org/x/net', 'monolog/monolog', 'react-dom', 'vue-router', 'jsonwebtoken',
  ],
  branch: [
    'feature/invoice-batching', 'fix/session-timeout', 'feature/search-facets', 'chore/deps-q3',
    'fix/rounding-vat', 'feature/webhook-retries', 'refactor/pricing-rules', 'fix/n-plus-one-orders',
  ],
  env: ['staging', 'staging-eu', 'preview', 'production-eu', 'production-us', 'qa'],
  cluster: ['k8s-eu-north-1', 'k8s-eu-west-2', 'k8s-us-east-1', 'k8s-staging'],
  namespace: ['payments', 'platform', 'search', 'web', 'workers', 'data'],
  dataset: [
    'support-tickets', 'product-catalog', 'release-notes', 'internal-wiki', 'api-reference',
    'incident-reports', 'onboarding-guides', 'changelog-archive',
  ],
  docset: [
    'API reference', 'onboarding guide', 'runbook', 'architecture overview', 'migration guide',
    'release notes', 'integration guide',
  ],
  pipeline: ['build-and-test', 'release', 'nightly', 'e2e-suite', 'security-scan', 'deploy-staging'],
  queue: ['emails', 'webhooks', 'exports', 'image-resize', 'indexing', 'invoices'],
  image: ['api-base', 'worker', 'web-frontend', 'cron-runner', 'search-node'],
  metric: ['p95 latency', 'error rate', 'queue lag', 'CPU throttling', 'memory pressure', 'cache hit ratio'],
  lang: ['TypeScript', 'PHP', 'Go', 'Python', 'Vue', 'Ruby'],
  topic: [
    'vector search tuning', 'rate limiting strategies', 'event sourcing', 'feature flag rollout',
    'cache invalidation', 'idempotent webhooks', 'zero-downtime migrations', 'LLM evaluation',
  ],
  host: ['node-04', 'node-07', 'node-11', 'node-15', 'node-22', 'node-31'],
  testfw: ['PHPUnit', 'Vitest', 'pytest', 'go test', 'Jest', 'Playwright'],
};

export type VocabKey = keyof typeof VOCAB;
