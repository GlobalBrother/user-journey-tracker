# User Journey Tracker - Dockerfile
# Deploy FastAPI backend to Azure Container Instances or App Service

FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies for pyodbc
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    unixodbc \
    unixodbc-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Microsoft ODBC Driver 18 for SQL Server
RUN curl https://packages.microsoft.com/keys/microsoft.asc | apt-key add - \
    && curl https://packages.microsoft.com/config/debian/11/prod.list > /etc/apt/sources.list.d/mssql-release.list \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install -y msodbcsql18 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY fastapi-backend.py .

# Expose port
EXPOSE 8000

# Set environment variables (override in Azure)
ENV UJT_API_KEY="your-api-key-here"
ENV AZURE_SQL_SERVER="your-server.database.windows.net"
ENV AZURE_SQL_DATABASE="user_journey_tracker"
ENV AZURE_SQL_USER="sqladmin"
ENV AZURE_SQL_PASSWORD=""

# Run FastAPI with uvicorn
CMD ["uvicorn", "fastapi-backend:app", "--host", "0.0.0.0", "--port", "8000"]
