import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from surprise import SVD, Dataset, Reader
from surprise.model_selection import train_test_split
import joblib
import mysql.connector
from mysql.connector import Error

# สร้างการเชื่อมต่อกับฐานข้อมูล
def load_data_from_db():
    try:
        connection = mysql.connector.connect(
            host='localhost',
            user='root',
            password='1234',
            database='ReviewAPP'
        )

        if connection.is_connected():
            print("เชื่อมต่อกับฐานข้อมูลสำเร็จ")
            query = "SELECT * FROM clean_new_view;"
            return pd.read_sql(query, connection)
    
    except Error as e:
        print(f"เกิดข้อผิดพลาดในการเชื่อมต่อกับฐานข้อมูล: {e}")
        return pd.DataFrame()  # คืนค่า DataFrame ว่างถ้ามีข้อผิดพลาด
    finally:
        if connection.is_connected():
            connection.close()
            print("ปิดการเชื่อมต่อฐานข้อมูลเรียบร้อยแล้ว")

# โหลดข้อมูลจากฐานข้อมูล
data = load_data_from_db()

# ตรวจสอบว่าไม่มีค่า NaN ในฟีเจอร์สำคัญ
data = data.dropna(subset=['post_content', 'category_name', 'user_age', 'total_interaction_score'])

# สร้างโมเดล SVD สำหรับ Collaborative Filtering
reader = Reader(rating_scale=(data['total_interaction_score'].min(), data['total_interaction_score'].max()))
interaction_data = Dataset.load_from_df(data[['user_id', 'post_id', 'total_interaction_score']], reader)

# แบ่งข้อมูลเป็น train และ test
trainset, testset = train_test_split(interaction_data, test_size=0.2)
collaborative_model = SVD()
collaborative_model.fit(trainset)

# บันทึกโมเดล SVD
joblib.dump(collaborative_model, 'collaborative_model.pkl')
print("Collaborative Filtering model (SVD) saved as 'collaborative_model.pkl'")

# รวมเนื้อหาโพสต์, ชื่อหมวดหมู่, และอายุผู้ใช้เพื่อใช้ใน Content-Based Filtering
data['interaction_time'] = pd.to_datetime(data['interaction_time'], errors='coerce')  # แปลงเป็น datetime
data['interaction_time'] = data['interaction_time'].dt.strftime('%Y-%m-%d %H:%M:%S')  # แปลงเป็น string

data['combined_content'] = (
    data['post_content'].fillna('') + ' ' +
    data['post_title'].fillna('') + ' ' +
    data['category_name'].fillna('') + ' อายุ: ' +
    data['user_age'].astype(str) + ' คะแนนโต้ตอบ: ' +
    data['total_interaction_score'].astype(str) + ' ความยาว: ' +
    data['post_content'].str.len().astype(str) + ' การกระทำ: ' +
    data['action_types'].fillna('') + ' เวลาโต้ตอบ: ' +
    data['interaction_time'].fillna('')
)

# แปลงเนื้อหาโพสต์และหมวดหมู่เป็นเวกเตอร์โดยใช้ TF-IDF
tfidf = TfidfVectorizer(stop_words='english', max_features=35000, ngram_range=(1, 3), min_df=2, max_df=0.8)
tfidf_matrix = tfidf.fit_transform(data['combined_content'])

# คำนวณ Cosine Similarity สำหรับโพสต์แต่ละอัน
cosine_sim = cosine_similarity(tfidf_matrix, tfidf_matrix)

# บันทึกโมเดล TF-IDF และ Cosine Similarity
joblib.dump(tfidf, 'tfidf_model.pkl')
joblib.dump(tfidf_matrix, 'tfidf_matrix.pkl')
joblib.dump(cosine_sim, 'cosine_similarity.pkl')
print("Content-Based Filtering model (TF-IDF) saved as 'tfidf_model.pkl', 'tfidf_matrix.pkl', and 'cosine_similarity.pkl'")
