# ---- Build Stage ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ---- Production Stage ----
FROM node:20-alpine AS runner

WORKDIR /app

# Instalar apenas dependências de produção
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copiar build compilado
COPY --from=builder /app/dist ./dist

# Criar usuário não-root
RUN addgroup --system --gid 1001 botbackend && \
    adduser --system --uid 1001 botbackend
USER botbackend

# Porta padrão da aplicação
EXPOSE 3001

# Variáveis de ambiente necessárias para OpenSSL legacy (certificados Serpro PFX)
ENV NODE_OPTIONS="--openssl-legacy-provider"

CMD ["node", "dist/index.js"]
