# ---- Build Stage ----
FROM node:20-alpine AS builder

WORKDIR /app

# Força NODE_ENV=development no build para garantir que devDependencies
# (@types/*, typescript) sejam instaladas — NODE_ENV=production do EasyPanel
# causaria npm ci a pular devDeps e quebrar a compilação TypeScript.
ENV NODE_ENV=development

COPY package.json package-lock.json* ./
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY src ./src
COPY certs ./certs

RUN npm run build

# ---- Production Stage ----
FROM node:20-alpine AS runner

WORKDIR /app

# Instalar apenas dependências de produção
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Copiar build compilado e certificados
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/certs ./certs

# Criar usuário não-root
RUN addgroup --system --gid 1001 botbackend && \
    adduser --system --uid 1001 botbackend
USER botbackend

# Porta padrão da aplicação
EXPOSE 3001

# Variáveis de ambiente necessárias para OpenSSL legacy (certificados Serpro PFX)
ENV NODE_OPTIONS="--openssl-legacy-provider"

CMD ["node", "dist/index.js"]
