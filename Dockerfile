FROM node:22-alpine
ARG NPM_TOKEN
WORKDIR /var/api
COPY . .
RUN npm install
# tsc needs more than the container's default heap. Measured 2026-08-25 on the
# t3.micro: node:22-alpine defaults to a 471 MB old-space limit and the build
# died at ~450 MB the moment the `openai` SDK (21 MB, 304 .d.ts files) joined
# @anthropic-ai/sdk in the type graph — "JavaScript heap out of memory", not a
# type error. The box has 916 MB RAM and a 2 GB swapfile, so 1536 MB is
# affordable at BUILD time only; the runtime container is still capped at 256 MB
# by the deploy script (L-002).
RUN NODE_OPTIONS=--max-old-space-size=1536 npm run build
CMD ["node", "dist/server.js"]