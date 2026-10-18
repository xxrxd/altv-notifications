FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
ENV PORT=3780
ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 3780
CMD ["node", "src/index.js"]
