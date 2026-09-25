# ---------- Dep stage ----------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ---------- Build stage ----------
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Si usas nest-cli.json/tsconfig*.json, se copian arriba con "COPY . ."
RUN npm run build

# ---------- Prod deps (solo prod) ----------
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ---------- Runner ----------
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist


EXPOSE 3000
CMD ["node", "dist/main.js"]
