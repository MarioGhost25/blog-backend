# Integration in progress — not ready to merge

This branch combines main at 25af259 with feature/publicaciones at b724977 and contains unfinished Socket.IO / English API changes. Do not deploy or merge until validation is complete.

## Implemented, pending runtime verification

- Socket.IO namespace /realtime and English room/event names, retaining PostgreSQL post-commit notifications.
- Injectable realtime repository and transaction-scoped PostsService operations without manual service construction.
- Administrative suspension authorization moved into the service.
- PresenciaSala / Usuario Prisma relation.
- Partial English response and contract migration.

## Outstanding work

- Finish English request/response/enum mappings and synchronize OpenAPI, tests, and frontend consumers.
- Regenerate HTTP fixtures from successful isolated integration tests. Existing fixtures have edited error envelope fields and are not fresh captures of this branch.
- Migrate browser/proxy WebSocket consumers from native ws to Socket.IO.
- Verify visible/retained comment delivery, rollback silence, group post events, user notifications, immediate suspension, reconnection and cross-instance authorization.
- Run Prisma validation/generation, build, unit, integration and contract checks successfully before merging.

## Actual validation evidence

- Prisma generation retried: engine checksum download from binaries.prisma.sh returns HTTP 403. Verification has not been disabled.
- Build blocked by Prisma generation; TypeScript checking also reports missing generated Prisma types.
- Unit tests: 6 suites passed, 4 failed; 27 executed tests passed. Not a passing full suite.
- Integration: 4 suites failed; 16 failed tests reported. Missing psql and missing generated client prevent meaningful full validation.
- Contract checking currently fails on legacy Spanish fixture states.
- Docker test PostgreSQL and Mailpit started successfully.
- git diff --check passed.

## Environment prerequisites

Save the proposed binaries.prisma.sh allowlist addition in environment settings, then retry Prisma with checksum verification enabled. Provide postgresql-client for the SQL tests; package installation was denied by operating-system permissions in this instance.
