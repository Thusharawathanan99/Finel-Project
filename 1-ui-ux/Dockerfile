# Multi-stage build for CareConnect Admin Web App
FROM node:20-alpine AS build

WORKDIR /app

# Copy package manifests and install dependencies
COPY 1-ui-ux/package*.json ./1-ui-ux/
WORKDIR /app/1-ui-ux
RUN npm ci --silent

# Copy app source and external dependencies (shared modules and safety validators)
WORKDIR /app
COPY 1-ui-ux ./1-ui-ux
COPY shared ./shared
COPY 4-system-engine/api/routes/*Safety.js ./4-system-engine/api/routes/

WORKDIR /app/1-ui-ux

ARG VITE_API_URL=/api
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY
ENV VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN
ENV VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID
ENV VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET
ENV VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID
ENV VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID

RUN npm run build

# Production serve with Nginx
FROM nginx:alpine

COPY --from=build /app/1-ui-ux/dist /usr/share/nginx/html
COPY 1-ui-ux/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80 443

CMD ["nginx", "-g", "daemon off;"]
