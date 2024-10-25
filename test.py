from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

# เรียกใช้ ChromeDriver
chrome_service = Service(ChromeDriverManager().install())
chrome_options = webdriver.ChromeOptions()

# เปิดใช้งาน WebDriver
driver = webdriver.Chrome(service=chrome_service, options=chrome_options)

# เปิดหน้าเว็บ Google
driver.get("https://www.google.com")

# พิมพ์ title ของหน้าเว็บเพื่อเช็คว่าการเปิดทำงานได้ถูกต้อง
print(driver.title)

# ปิดเบราว์เซอร์
driver.quit()
