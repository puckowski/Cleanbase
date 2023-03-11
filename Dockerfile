FROM node:current-alpine3.15

ARG FileZip
COPY ${FileZip} /build.zip
COPY zip_safety.sh /zip_safety.sh

WORKDIR /

RUN sh /zip_safety.sh

RUN unzip build.zip

EXPOSE 80

CMD ["node", "server.js"]

