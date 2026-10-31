# Swarm Engine — Unbounded Subagent Decomposition Patterns

This guide provides concrete, battle-tested prompt decomposition templates for deploying **5, 10, 15, and 20+ specialized parallel subagents** with Swarm Engine.

All templates leverage **infinite concurrency** (`maxConcurrency: 0`) and **zero queuing** across isolated Git worktrees, ensuring zero file collisions through non-overlapping `targetFiles`.

---

## 1. Core Principles of Subagent Decomposition

1. **Orthogonal File Boundaries**:
   Ensure each agent's `targetFiles` array contains distinct files. Two agents should never be assigned to modify the same file concurrently without a dependency relationship (`dependsOn`).
2. **Contract-First Coordination via Blackboard**:
   When agents require shared interfaces, the lead architect or schema engineer writes the contract to the shared blackboard using `write_blackboard`. Downstream agents consume these contracts asynchronously.
3. **Hyper-Specialization Over Generalization**:
   Instead of one agent writing code and tests for an entire subsystem, split the responsibilities: one agent writes domain logic, one writes schema migrations, one writes unit tests, and one writes documentation.

---

## 2. The 5-Agent Pattern: Core Feature Slice

Ideal for targeted feature additions, library integrations, or focused refactorings.

```
       ┌────────────────────────┐
       │   system_architect     │──(writes contract to blackboard)
       └───────────┬────────────┘
                   │
    ┌──────────────┼──────────────┬──────────────┐
    ▼              ▼              ▼              ▼
┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐
│db_eng  │    │api_dev │    │qa_test │    │docs_eng│
└────────┘    └────────┘    └────────┘    └────────┘
```

| Agent ID | Role | Responsibilities | Target Files |
|---|---|---|---|
| `agent-arch` | `system_architect` | Defines data types, error enums, and blackboard contracts | `src/features/billing/types.ts` |
| `agent-db` | `db_schema_engineer` | Creates schema migrations and database queries | `src/features/billing/schema.ts`, `migrations/004_billing.sql` |
| `agent-api` | `api_route_builder` | Implements business logic controllers and routes | `src/features/billing/routes.ts`, `src/features/billing/service.ts` |
| `agent-test` | `unit_test_writer` | Implements comprehensive unit and regression tests | `test/features/billing.spec.ts` |
| `agent-docs` | `docs_engineer` | Writes OpenAPI specs and feature usage guides | `docs/features/billing.md`, `README.md` |

---

## 3. The 10-Agent Pattern: Full-Stack Application Slice

Ideal for full-stack features spanning database, backend API, state management, UI components, and end-to-end tests.

```
Wave 1 (Contracts & Schemas) ───────► Wave 2 (Implementation) ───────► Wave 3 (Validation)
- fullstack_architect                 - api_controller_dev              - unit_test_writer
- db_schema_engineer                  - frontend_ui_builder             - e2e_playwright_qa
- auth_security_guard                 - state_store_engineer            - docs_technical_writer
                                      - api_client_sdk
```

| Agent ID | Role | Scope of Work | Target Files |
|---|---|---|---|
| `fs-01` | `fullstack_architect` | Base contracts, shared interfaces, API payload specifications | `src/shared/types/checkout.ts` |
| `fs-02` | `db_schema_engineer` | Order tables, transaction tables, and index definitions | `src/backend/db/orders.ts`, `migrations/010_orders.sql` |
| `fs-03` | `auth_security_guard` | Role-based permission checks and payment webhook validation | `src/backend/middleware/paymentAuth.ts` |
| `fs-04` | `api_controller_dev` | Checkout endpoints, invoice generation, and status checks | `src/backend/controllers/checkout.ts` |
| `fs-05` | `api_client_sdk` | Frontend HTTP client, typed hooks, and mutation helpers | `src/frontend/api/checkoutClient.ts` |
| `fs-06` | `state_store_engineer` | Cart state machine, payment processing states, cache | `src/frontend/store/cartStore.ts` |
| `fs-07` | `frontend_ui_builder` | Responsive checkout form, payment modal, order summary | `src/frontend/components/CheckoutView.tsx` |
| `fs-08` | `unit_test_writer` | Backend controller tests, calculation unit tests | `test/backend/checkout.test.ts` |
| `fs-09` | `e2e_playwright_qa` | End-to-end checkout flow with simulated payment gateway | `test/e2e/checkout.spec.ts` |
| `fs-10` | `docs_technical_writer`| Checkout API documentation, user guide, and release notes | `docs/api/checkout.md`, `CHANGELOG.md` |

---

## 4. The 15-Agent Pattern: Enterprise Cloud Microservice

Ideal for distributed microservices, message queue processing, caching layers, and high-assurance security auditing.

| Agent ID | Role | Responsibilities | Target Files |
|---|---|---|---|
| `srv-01` | `system_architect` | Domain event schemas, REST interfaces, blackboard contract | `src/domain/events.ts` |
| `srv-02` | `data_modeler` | PostgreSQL table schemas and foreign key cascades | `src/db/tables.ts` |
| `srv-03` | `orm_repository` | Repository pattern query methods and connection pooling | `src/db/repository.ts` |
| `srv-04` | `rest_controller` | REST endpoints with JSON schema validation | `src/controllers/api.ts` |
| `srv-05` | `graphql_resolver` | GraphQL schema, query resolvers, and mutations | `src/graphql/schema.ts`, `src/graphql/resolvers.ts` |
| `srv-06` | `rbac_guard` | OAuth2/OIDC token claims validation and RBAC guards | `src/security/rbac.ts` |
| `srv-07` | `redis_cacher` | Multi-level cache manager with TTL and pub/sub invalidation | `src/cache/redis.ts` |
| `srv-08` | `kafka_producer` | Event publishing with retry backoff and idempotency keys | `src/events/producer.ts` |
| `srv-09` | `kafka_consumer` | Background worker consuming order fulfillment events | `src/events/consumer.ts` |
| `srv-10` | `unit_tester` | Isolated business logic and pure function testing | `test/unit/services.test.ts` |
| `srv-11` | `contract_tester` | Consumer-driven contract tests (Pact / OpenAPI mocks) | `test/contract/api.test.ts` |
| `srv-12` | `security_auditor` | OWASP Top 10 automated scans, SQL injection fuzzing | `test/security/audit.spec.ts` |
| `srv-13` | `perf_optimizer` | Load test scripts (k6) and CPU hot-path optimizations | `test/perf/load.js`, `src/utils/fastJson.ts` |
| `srv-14` | `devops_engineer` | Multi-stage Dockerfile, Kubernetes manifests, Helm charts | `Dockerfile`, `k8s/deployment.yaml` |
| `srv-15` | `tech_writer` | Architecture decision records (ADR) and API guides | `docs/adr/001-microservice.md`, `docs/api.md` |

---

## 5. The 20+ Agent Pattern: Massive Monolithic Modernization

When migrating a legacy monolithic application to a modular architecture, Swarm Engine allows deploying **20 or more specialized agents simultaneously** with zero queuing:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 MASSIVE MONOLITHIC MODERNIZATION SWARM                      │
├──────────────────────┬──────────────────────┬───────────────────────────────┤
│ ARCHITECTURE & DATA  │ SERVICES & WORKERS   │ CLIENT & FRONTEND             │
│ • mono-01: Architect │ • mono-07: Payment   │ • mono-12: Design Tokens      │
│ • mono-02: DB Schema │ • mono-08: Notifier  │ • mono-13: UI Core Kit        │
│ • mono-03: Migrator  │ • mono-09: Webhook   │ • mono-14: Navigation         │
│ • mono-04: Caching   │ • mono-10: Queue Eng │ • mono-15: State Machine      │
│ • mono-05: Auth Dev  │ • mono-11: Search    │ • mono-16: Client SDK         │
│ • mono-06: RBAC      │                      │                               │
├──────────────────────┴──────────────────────┴───────────────────────────────┤
│ QUALITY ASSURANCE, OBSERVABILITY & PLATFORM                                 │
│ • mono-17: Unit QA     • mono-18: E2E QA      • mono-19: Sec Auditor        │
│ • mono-20: Benchmarks  • mono-21: Telemetry   • mono-22: DevOps/CI          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Full Agent Mapping & Non-Overlapping Targets

1. `mono-01` (`enterprise_architect`): `src/core/contracts.ts` — Global types and blackboard interfaces.
2. `mono-02` (`db_schema_designer`): `src/database/schema.ts` — Normalizes legacy schemas into modular entities.
3. `mono-03` (`db_migration_engineer`): `migrations/100_split_monolith.sql` — Safe forward/rollback SQL scripts.
4. `mono-04` (`distributed_cache_dev`): `src/cache/tieredCache.ts` — Redis L2 and local memory L1 cache layer.
5. `mono-05` (`auth_subsystem_dev`): `src/auth/jwtProvider.ts` — Decoupled token issuance and refresh logic.
6. `mono-06` (`rbac_policy_engineer`): `src/auth/policyEngine.ts` — Policy decision point (PDP) implementation.
7. `mono-07` (`payment_service_dev`): `src/services/paymentService.ts` — Stripe/PayPal adapter abstraction.
8. `mono-08` (`notification_worker`): `src/services/notificationService.ts` — Email/SMS/Push multi-channel dispatcher.
9. `mono-09` (`webhook_processor`): `src/services/webhookService.ts` — Incoming webhook signature validation.
10. `mono-10` (`queue_infrastructure`): `src/queues/jobScheduler.ts` — BullMQ distributed queue orchestration.
11. `mono-11` (`search_engine_dev`): `src/search/elasticClient.ts` — Elasticsearch ingestion and indexing pipeline.
12. `mono-12` (`ui_token_designer`): `src/ui/tokens/colors.ts`, `src/ui/tokens/typography.ts` — Modern design system tokens.
13. `mono-13` (`ui_component_library`): `src/ui/components/Button.tsx`, `src/ui/components/Card.tsx` — Reusable atom components.
14. `mono-14` (`ui_navigation_dev`): `src/ui/navigation/Sidebar.tsx` — Layout headers and responsive navigation.
15. `mono-15` (`state_machine_dev`): `src/store/appStateMachine.ts` — XState machine for global user sessions.
16. `mono-16` (`client_sdk_builder`): `src/sdk/apiSdk.ts` — Auto-generated TypeScript client SDK with retry logic.
17. `mono-17` (`unit_test_author`): `test/unit/services.spec.ts` — Service layer mock test suites.
18. `mono-18` (`e2e_playwright_dev`): `test/e2e/monolith_regression.spec.ts` — Full user regression test suite.
19. `mono-19` (`security_auditor`): `audit/security_report.md` — Static analysis and secret leak inspection.
20. `mono-20` (`benchmarking_specialist`): `test/bench/throughput.bench.ts` — Nanosecond performance benchmarks.
21. `mono-21` (`telemetry_engineer`): `src/telemetry/openTelemetry.ts` — Distributed tracing and Prometheus metrics.
22. `mono-22` (`devops_pipeline_engineer`): `.github/workflows/ci.yml`, `docker-compose.yml` — Multi-stage CI pipeline.

All 22 agents execute **concurrently** in `.swarm/worktrees/mono-01` through `mono-22`. Because every file target is isolated, all 22 agents complete without a single merge conflict!
