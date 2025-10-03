FROM node:22-alpine
ARG NPM_TOKEN
WORKDIR /var/api
COPY . .
RUN npm install
RUN npm run build
CMD ["node", "dist/server.js"]