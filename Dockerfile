FROM python:3.12-slim

WORKDIR /app

COPY . /app

ENV WEBNAV_DATA_DIR=/data

VOLUME ["/data"]

EXPOSE 19792

CMD ["python3", "/app/server.py", "--host", "0.0.0.0", "--port", "19792", "--data-dir", "/data"]
