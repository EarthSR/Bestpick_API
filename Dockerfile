# ใช้ Node.js เป็น Base Image
FROM node:14

# ติดตั้ง Python และ C++ development tools
RUN apt-get update && apt-get install -y python3 python3-pip wget unzip build-essential g++ \
    libatlas-base-dev libopenblas-dev

# ตรวจสอบ Python เวอร์ชัน (จะพิมพ์ออกมาระหว่าง build)
RUN python3 --version

# กำหนด Working Directory
WORKDIR /app

# คัดลอกไฟล์ requirements.txt ก่อน
COPY requirements.txt ./

# ติดตั้ง wheel และ dependencies ทั้งหมดจาก requirements.txt
RUN pip3 install --no-cache-dir wheel && \
    pip3 install --no-cache-dir -r requirements.txt

# คัดลอกไฟล์ทั้งหมดไปที่ container
COPY . .

# ติดตั้ง Chrome และ ChromeDriver
RUN wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && \
    apt install -y ./google-chrome-stable_current_amd64.deb && \
    rm google-chrome-stable_current_amd64.deb

RUN wget https://chromedriver.storage.googleapis.com/$(curl -sS chromedriver.storage.googleapis.com/LATEST_RELEASE)/chromedriver_linux64.zip && \
    unzip chromedriver_linux64.zip -d /usr/local/bin/ && \
    rm chromedriver_linux64.zip && \
    chmod +x /usr/local/bin/chromedriver

# กำหนด PATH ให้ ChromeDriver
ENV PATH="/usr/local/bin:${PATH}"

# ทำความสะอาด cache
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

# กำหนดคำสั่งเริ่มต้น
CMD ["sh", "-c", "node server.js && python3 botgetprice.py"]
