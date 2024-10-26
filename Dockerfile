# ใช้ Node.js เป็น Base Image
FROM node:14

# ติดตั้ง Python
RUN apt-get update && apt-get install -y python3 python3-pip

# กำหนด Working Directory
WORKDIR /app

# คัดลอกไฟล์ทั้งหมดไปที่ container
COPY . .

# ติดตั้ง dependencies สำหรับ Node.js และ Python
RUN npm install && pip3 install -r requirements.txt  # ตรวจสอบว่า requirements.txt มีอยู่สำหรับ Python dependencies

# กำหนดคำสั่งเริ่มต้น
CMD sh -c "node server.js & python3 botgetprice.py"
