ARG PAPERCLIP_BASE_IMAGE
FROM ${PAPERCLIP_BASE_IMAGE}
COPY adapter.tgz assembly.json image-probe.mjs /opt/cityos/paperclip-adapter/
RUN mkdir /opt/cityos/paperclip-adapter/package \
  && tar -xzf /opt/cityos/paperclip-adapter/adapter.tgz --strip-components=1 -C /opt/cityos/paperclip-adapter/package \
  && chmod -R a+rX /opt/cityos/paperclip-adapter
