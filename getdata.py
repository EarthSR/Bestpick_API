import pandas as pd
import mysql.connector  # สำหรับ MySQL

# สร้างการเชื่อมต่อกับฐานข้อมูล
connection = mysql.connector.connect(
    host='gateway01.ap-southeast-1.prod.aws.tidbcloud.com',
    user='dsDDUQmqsjovA5G.root',
    password='xQaYQK0gJ6BFKoQy',
    database='ReviewAPP'
)

# ดึงข้อมูลจากฐานข้อมูล
query = "SELECT * FROM user_interactions;"
df = pd.read_sql(query, connection)

# ส่งออกข้อมูลเป็น CSV
df.to_csv('user_interactions.csv', index=False)

# ส่งออกข้อมูลเป็น Excel
df.to_excel('user_interactions.xlsx', index=False)

# ปิดการเชื่อมต่อ
connection.close()
