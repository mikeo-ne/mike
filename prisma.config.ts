import { defineConfig, env } from 'prisma/config';

// Prisma 7 keeps connection URLs out of the schema file: Migrate reads the
// URL from here. Reuses the existing POSTGRES_URL secret (Neon today).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('POSTGRES_URL'),
  },
});
