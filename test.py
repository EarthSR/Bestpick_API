from selenium import webdriver
from selenium.webdriver.chrome.service import Service
import os

# กำหนด path ของ chromedriver.exe ภายในโฟลเดอร์ chromedriver
chrome_driver_path = os.path.join(os.getcwd(), "chromedriver", "chromedriver.exe")

# สร้าง Service object สำหรับ Chrome Driver
service = Service(executable_path=chrome_driver_path)

# สร้าง instance ของ Chrome Driver โดยใช้ Service object
driver = webdriver.Chrome(service=service)

# ทำสิ่งที่ต้องการ เช่น เปิดเว็บไซต์
driver.get("https://www.google.com")

# ปิด browser หลังการใช้งาน
driver.quit()
