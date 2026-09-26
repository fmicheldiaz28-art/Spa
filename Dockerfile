# Imagen única del monorepo para la nube (Railway): la misma imagen sirve al API y a la web;
# cada servicio define su propio comando de inicio (docs/13-operacion-runbooks.md §13.3).
FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

# La web resuelve el destino del rewrite /api/v1 al compilar: necesita la URL privada del API.
ARG API_URL
ENV API_URL=${API_URL}
# prisma generate lee DATABASE_URL de la configuración, pero no se conecta: basta un valor de relleno.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build NODE_ENV=production pnpm build

ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@naturalspa/api", "start"]
