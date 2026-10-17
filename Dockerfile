# ---- Adways Doubt-Clearing Platform — single-image build (API + built SPA) ----
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Install all workspace deps (dev included, for the build).
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci

# Build server (tsc) and web (vite). Prisma client is generated in server build.
COPY . .
RUN npm run build

# ---- Runtime image ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci --omit=dev

# Compiled server, generated Prisma client + migrations, and the built SPA.
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/prisma server/prisma
COPY --from=build /app/node_modules/.prisma node_modules/.prisma
COPY --from=build /app/node_modules/@prisma node_modules/@prisma
COPY --from=build /app/web/dist web/dist

EXPOSE 3001
# Apply migrations on boot, then start the API + in-process worker.
CMD ["sh", "-c", "cd server && npx prisma migrate deploy && node dist/index.js"]
