FROM searxng/searxng:latest
USER root
COPY settings.yml /etc/searxng/settings.yml
COPY entrypoint.sh /usr/local/bin/prospectpilot-searxng
RUN chmod +x /usr/local/bin/prospectpilot-searxng
ENTRYPOINT ["/usr/local/bin/prospectpilot-searxng"]
