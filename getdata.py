import pandas as pd
import mysql.connector  # สำหรับ MySQL

# สร้างการเชื่อมต่อกับฐานข้อมูล
connection = mysql.connector.connect(
    host='localhost',
    user='root',
    password='1234',
    database='ReviewAPP'
)

# ดึงข้อมูลจากฐานข้อมูล
query = "SELECT * FROM clean_new;"
df = pd.read_sql(query, connection)



# ส่งออกข้อมูลเป็น CSV
df.to_csv('clean_new.csv', index=False)


# ปิดการเชื่อมต่อ
connection.close()

print(df.head())
