# ใช้ Node.js เป็น Base Image
FROM node:14

# ติดตั้ง Python และ C++ development tools
RUN apt-get update && apt-get install -y python3 python3-pip python3-venv python3-dev wget unzip build-essential g++ \
    libatlas-base-dev libopenblas-dev apt-transport-https ca-certificates gnupg gfortran liblapack-dev libblas-dev \
    --no-install-recommends

# สร้าง Virtual Environment สำหรับ Python
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# ตรวจสอบ Python เวอร์ชัน (จะพิมพ์ออกมาระหว่าง build)
RUN python3 --version

# ติดตั้ง PM2 สำหรับจัดการหลายโปรเซส
RUN npm install -g pm2

# กำหนด Working Directory
WORKDIR /app

# คัดลอกไฟล์ requirements.txt ก่อน
COPY requirements.txt ./

# ติดตั้ง wheel และ dependencies ทั้งหมดจาก requirements.txt
RUN pip install --no-cache-dir wheel && \
    pip install --no-cache-dir -r requirements.txt

# ติดตั้ง scikit-surprise โดยระบุเวอร์ชันที่มี pre-built wheel
RUN pip install scikit-surprise==1.1.1

# คัดลอกไฟล์ทั้งหมดไปที่ container
COPY . .

# ติดตั้ง Firefox
RUN apt-get update && apt-get install -y --no-install-recommends firefox-esr

# ติดตั้ง GeckoDriver
RUN wget https://github.com/mozilla/geckodriver/releases/download/v0.31.0/geckodriver-v0.31.0-linux64.tar.gz && \
    tar -xvzf geckodriver-v0.31.0-linux64.tar.gz -C /usr/local/bin/ && \
    rm geckodriver-v0.31.0-linux64.tar.gz

# กำหนด PATH ให้ GeckoDriver
ENV PATH="/usr/local/bin:${PATH}"

# ทำความสะอาด cache
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

# กำหนดคำสั่งเริ่มต้นให้รัน server.js และ botgetprice.py ด้วย pm2
CMD ["pm2-runtime", "start", "server.js", "--no-daemon", "--", "python3 botgetprice.py"]
