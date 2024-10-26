# Imports for data handling, modeling, and SQLAlchemy engine creation
import pandas as pd
from sqlalchemy import create_engine
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.feature_extraction.text import TfidfVectorizer
import joblib  # For saving/loading precomputed matrices


collaborative_model = joblib.load('collaborative_model.pkl')
tfidf = joblib.load('tfidf_model.pkl')
tfidf_matrix = joblib.load('tfidf_matrix.pkl')
cosine_sim = joblib.load('cosine_similarity.pkl')

def load_data_from_db():
    try:
        # ตรวจสอบการเชื่อมต่อฐานข้อมูล
        engine = create_engine('mysql+mysqlconnector://root:1234@localhost/ReviewAPP')
        query = "SELECT * FROM clean_new_view;"
        data = pd.read_sql(query, con=engine)
        print("Data loaded successfully.")
        return data
    except Exception as e:
        print(f"Error loading data: {e}")
        return pd.DataFrame()  # ส่ง DataFrame ว่างกลับหากมีข้อผิดพลาด

# ฟังก์ชันสำหรับแนะนำโพสต์ตามเนื้อหาที่คล้ายกัน
def content_based_recommendations(post_id, user_id, cosine_sim=cosine_sim, threshold=0.3):
    data = load_data_from_db()
    try:
        idx = data.index[data['post_id'] == post_id][0]
        sim_scores = list(enumerate(cosine_sim[idx]))
        # กรองโพสต์ที่มีค่า Cosine Similarity มากกว่า threshold
        sim_scores = [score for score in sim_scores if score[1] > threshold]
        sim_scores = sorted(sim_scores, key=lambda x: x[1], reverse=True)
        post_indices = [i[0] for i in sim_scores[:10]]  # เลือก 10 อันดับแรก
        
        print(f"Post ID: {post_id}, Similar Posts: {data['post_id'].iloc[post_indices].values}")
        return data['post_id'].iloc[post_indices]
    except IndexError:
        return []


# ฟังก์ชัน Hybrid สำหรับแนะนำโพสต์
def hybrid_recommendations(user_id, post_id, alpha=0.85):
    # คาดการณ์จาก Collaborative Filtering
    collab_pred = collaborative_model.predict(user_id, post_id).est
    
    # เรียกใช้ Content-Based Recommendations
    content_recs = content_based_recommendations(post_id, user_id)
    content_pred = 0.5 if post_id in content_recs else 0
    
    # คำนวณคะแนนสุดท้ายโดยให้น้ำหนักกับ Collaborative Filtering มากกว่า
    final_score = alpha * collab_pred + (1 - alpha) * content_pred
    return {"post_id": post_id, "final_score": final_score}

def recommend_posts_for_user(user_id, alpha=0.7):
    data = load_data_from_db()  # โหลดข้อมูลใหม่ทุกครั้ง

    # ลบโพสต์ที่มี post_id ซ้ำใน DataFrame
    data = data.drop_duplicates(subset='post_id')

    post_scores = []

    # วันที่ปัจจุบัน
    current_date = pd.to_datetime("now")

    # วนผ่านโพสต์ทั้งหมดเพื่อคำนวณคะแนนการแนะนำ
    for post_id in data['post_id'].unique():
        score = hybrid_recommendations(user_id, post_id, alpha=alpha)
        final_score = float(score['final_score'])

        # เพิ่มคะแนนสำหรับโพสต์ใหม่ (ถ้ามีคอลัมน์ updated_at)
        post_date = pd.to_datetime(data.loc[data['post_id'] == post_id, 'updated_at'].values[0])
        age_in_days = (current_date - post_date).days

        # สมมุติว่าเพิ่ม 2 คะแนนสำหรับโพสต์ที่สร้างใน 7 วันที่ผ่านมา
        if age_in_days <= 7:
            final_score += 1.0  # เพิ่มคะแนนให้กับโพสต์ใหม่

        post_scores.append((int(score['post_id']), final_score))  # แปลงเป็น int และ float เพื่อความปลอดภัยในการ serialize


    # เรียงลำดับโพสต์ตามคะแนนจากมากไปน้อย
    post_scores = sorted(post_scores, key=lambda x: x[1], reverse=True)  # เรียงตามคะแนน


    # สุ่มเลือก 3 โพสต์แรกที่มีคะแนนสูงสุด
    top_posts = post_scores[:3]  # 3 โพสต์แรกที่มีคะแนนสูงสุด
    remaining_posts = post_scores[3:]  # โพสต์ที่เหลือ

    # แสดงผลโพสต์ที่แนะนำ
    recommended_posts = top_posts + remaining_posts  # รวมผลลัพธ์

    return recommended_posts

recommend_posts = recommend_posts_for_user(user_id=1200003)
print(recommend_posts)