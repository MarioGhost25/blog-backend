# Repository Guidelines

## Project Structure & Module Organization

This NestJS 11 backend uses TypeScript, Prisma 7, and PostgreSQL. Feature modules live in `src/auth`, `src/users`, `src/posts`, `src/groups`, and `src/categories`. Keep HTTP handling in controllers, business logic in services, and database access in repositories. Place DTOs, guards, interceptors, and types beside their feature.

Shared validation lives in `src/common`; environment validation is in `src/config`. `src/prisma` provides database integration, while `prisma/schema.prisma` and `prisma/migrations` define database structure. `README.md` lists API routes under `/api/v1`. Uploaded media uses Cloudinary; this repository has no dedicated static asset directory.

## Build, Test, and Development Commands

- `npm ci`: install locked dependencies.
- `docker compose up -d`: start the local PostgreSQL service using environment settings.
- `npm run start:dev`: run Nest with automatic reload.
- `npm run build`: generate Prisma Client using `prisma7.config.ts`, then compile the application.
- `npm run start:prod`: run the compiled `dist/src/main.js` entry point.
- `npm run lint`: run ESLint with automatic fixes.
- `npm run format`: apply Prettier to source and test files.
- `npm test` / `npm run test:cov`: run Jest or collect coverage.

## Coding Style & Naming Conventions

Use two-space indentation, single quotes, and trailing commas, following Prettier. ESLint includes type-aware TypeScript checks. Use PascalCase for classes and camelCase for methods and variables. Follow filenames such as `posts.repository.ts` and `create-post.dto.ts`. Preserve repository mappings between Spanish database fields and English API properties.

## Testing Guidelines

Jest with ts-jest discovers `*.spec.ts` files inside `src`; colocate new unit tests with the code they exercise. Cover validation, permissions, and failure paths for changed behavior. No tests or coverage threshold currently exist. The `test:e2e` script references a missing `test/jest-e2e.json`; add that configuration before using it.

## Commit & Pull Request Guidelines

History mixes informal messages with `feat(scope): description`; prefer the latter pattern, for example `feat(posts): add attachment validation`. Keep commits focused. PRs should explain behavior changes, link relevant issues, document configuration or migration needs, and report validation results. Update endpoint documentation when routes change.

## Security & Configuration

Copy `.env.template` to `.env` and supply local values. Also configure `JWT_SECRET`, which is required by `src/config/joi.validation.ts` but absent from the template. Never commit credentials or real tokens.
