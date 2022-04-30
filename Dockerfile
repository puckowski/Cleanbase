FROM node:current-alpine3.15

ARG FileZip
COPY ${FileZip} /build.zip

WORKDIR /

RUN unzip build.zip

EXPOSE 80

CMD ["node", "server.js"]

