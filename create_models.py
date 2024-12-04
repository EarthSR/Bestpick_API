import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from surprise import SVD, Dataset, Reader
import joblib

# ฟังก์ชันสำหรับโหลดข้อมูลจาก CSV
def load_data_from_csv():
    file_path = 'clean_new_view.csv'  # แก้ไขให้ตรงกับที่อยู่ของไฟล์ CSV ของคุณ
    data = pd.read_csv(file_path)  # โหลดข้อมูลจาก CSV
    return data

# ฟังก์ชันสำหรับสร้างโมเดล Collaborative Filtering (SVD)
def create_collaborative_model(data):
    reader = Reader(rating_scale=(data['total_interaction_score'].min(), data['total_interaction_score'].max()))
    interaction_data = Dataset.load_from_df(data[['user_id', 'post_id', 'total_interaction_score']], reader)
    
    # ปรับพารามิเตอร์ SVD สำหรับการทำงานที่ดีขึ้น
    collaborative_model = SVD(n_factors=100, n_epochs=50, lr_all=0.005, reg_all=0.02)
    trainset = interaction_data.build_full_trainset()
    collaborative_model.fit(trainset)
    
    joblib.dump(collaborative_model, 'collaborative_model.pkl')
    print("Collaborative Filtering model (SVD) saved as 'collaborative_model.pkl'")
    return collaborative_model

# ฟังก์ชันสำหรับสร้าง Content-Based Filtering (TF-IDF + Cosine Similarity)
def create_content_based_model(data):
    tfidf = TfidfVectorizer(stop_words='english', max_features=15000, ngram_range=(1, 3), min_df=2, max_df=0.75)
    combined_content = (
        data['post_content'].fillna('') + ' ' +
        data['post_title'].fillna('') + ' ' +
        data['category_name'].fillna('') + ' อายุ: ' +
        data['user_age'].astype(str) + ' คะแนนโต้ตอบ: ' +
        data['total_interaction_score'].astype(str) + ' ความยาว: ' +
        data['post_content'].str.len().astype(str) + ' การกระทำ: ' +
        data['action_types'].fillna('') + ' เวลาโต้ตอบ: ' +
        data['interaction_time'].fillna('')
    )
    
    tfidf_matrix = tfidf.fit_transform(combined_content)
    cosine_sim = cosine_similarity(tfidf_matrix, tfidf_matrix)
    
    joblib.dump(tfidf, 'tfidf_model.pkl')
    joblib.dump(tfidf_matrix, 'tfidf_matrix.pkl')
    joblib.dump(cosine_sim, 'cosine_similarity.pkl')
    print("Content-Based Filtering model (TF-IDF) saved as 'tfidf_model.pkl', 'tfidf_matrix.pkl', and 'cosine_similarity.pkl'")
    return cosine_sim

# เรียกใช้งานเพื่อสร้างโมเดล SVD และ TF-IDF
data = load_data_from_csv()
create_collaborative_model(data)
create_content_based_model(data)
