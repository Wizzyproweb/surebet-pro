FROM python:3.12-slim

WORKDIR /app

# Install dependencies
RUN pip install flask gunicorn requests

# Copy app
COPY . .

# Expose port
EXPOSE 80

# Start
CMD ["gunicorn", "wsgi:application", "--bind", "0.0.0.0:80", "--workers", "1", "--threads", "4", "--worker-class", "gthread"]
