import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from surprise import SVD, Dataset, Reader
from surprise.model_selection import train_test_split
import joblib

# โหลดข้อมูลจากไฟล์ CSV
data = pd.read_csv('clean_new.csv')

# ตรวจสอบข้อมูลเบื้องต้น
# print(data.head())

# เตรียมข้อมูลการปฏิสัมพันธ์ของผู้ใช้กับโพสต์ (SVD)
reader = Reader(rating_scale=(data['interaction_score'].min(), data['interaction_score'].max()))
interaction_data = Dataset.load_from_df(data[['user_id', 'post_id', 'interaction_score']], reader)

# แบ่งข้อมูลเป็น train และ test
trainset, testset = train_test_split(interaction_data, test_size=0.2)

# สร้างโมเดล SVD สำหรับ Collaborative Filtering
collaborative_model = SVD()
collaborative_model.fit(trainset)

# บันทึกโมเดล SVD
joblib.dump(collaborative_model, 'collaborative_model.pkl')
print("Collaborative Filtering model (SVD) saved as 'collaborative_model.pkl'")

# รวมเนื้อหาโพสต์กับชื่อหมวดหมู่เพื่อใช้ใน Content-Based Filtering
data['combined_content'] = data['post_content'] + ' ' + data['category_name']

# แปลงเนื้อหาโพสต์และหมวดหมู่เป็นเวกเตอร์โดยใช้ TF-IDF
tfidf = TfidfVectorizer(stop_words='english', max_features=10000, ngram_range=(1, 2))  # ใช้ bi-gram
tfidf_matrix = tfidf.fit_transform(data['combined_content'])

print(data['combined_content'].head())


# คำนวณ Cosine Similarity สำหรับโพสต์แต่ละอัน
cosine_sim = cosine_similarity(tfidf_matrix, tfidf_matrix)

# บันทึกโมเดล TF-IDF, เวกเตอร์ความคล้ายคลึง และ Cosine Similarity
joblib.dump(tfidf, 'tfidf_model.pkl')
joblib.dump(tfidf_matrix, 'tfidf_matrix.pkl')
joblib.dump(cosine_sim, 'cosine_similarity.pkl')
print("Content-Based Filtering model (TF-IDF) saved as 'tfidf_model.pkl', 'tfidf_matrix.pkl', and 'cosine_similarity.pkl'")
