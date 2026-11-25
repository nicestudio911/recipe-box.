FROM litestream/litestream:0.3.13 AS litestream

FROM node:22-slim
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data TRUST_PROXY=1 PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
RUN chmod +x start.sh && mkdir -p /data
VOLUME /data
EXPOSE 3000
HEALTHCHECK CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["./start.sh"]
