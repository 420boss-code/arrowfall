# Arrowfall – the full online game (maths site, sign-in, servers, parties, friends) in one container.
# Works on any host that runs a Dockerfile: Koyeb, Northflank, Fly.io, Railway, Render, SnapDeploy…
# Set ADMIN_PASSWORD and CODE_SECRET on the host (use the same CODE_SECRET everywhere and every
# player code works on every copy). The host gives the port in PORT; 8080 is used otherwise.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 TRUST_PROXY=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY src ./src
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "server/index.js"]
