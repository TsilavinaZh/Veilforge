FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV VEILFORGE_DB_PATH=/data/veilforge.db
RUN mkdir -p /data
EXPOSE 8787
CMD ["uvicorn", "veilforge.main:app", "--host", "0.0.0.0", "--port", "8787"]
