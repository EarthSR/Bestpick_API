import joblib
import pandas as pd
from sklearn.metrics import mean_squared_error
from surprise import SVD, Dataset, Reader
from surprise.model_selection import train_test_split, cross_validate
from math import sqrt

# ฟังก์ชันสำหรับโหลดข้อมูลจาก CSV
def load_data_from_csv():
    file_path = 'clean_new_view.csv'  # แก้ไขให้ตรงกับที่อยู่ของไฟล์ CSV ของคุณ
    data = pd.read_csv(file_path)
    return data

# ฟังก์ชันสำหรับการแนะนำโพสต์ด้วย Hybrid Model
def hybrid_recommendations(user_id, post_id, alpha=0.75, collaborative_model=None, cosine_sim=None, data=None):
    # คาดการณ์จาก Collaborative Filtering
    collab_pred = collaborative_model.predict(user_id, post_id).est
    
    # คำนวณ Content-Based Recommendations
    try:
        idx = data.index[data['post_id'] == post_id][0]
        sim_scores = list(enumerate(cosine_sim[idx]))
        sim_scores = sorted(sim_scores, key=lambda x: x[1], reverse=True)
        sim_scores = sim_scores[1:11]
        post_indices = [i[0] for i in sim_scores]
        content_pred = 0.5 if post_id in data['post_id'].iloc[post_indices].values else 0
    except IndexError:
        content_pred = 0
    
    # คำนวณคะแนนสุดท้าย
    final_score = alpha * collab_pred + (1 - alpha) * content_pred
    return {"post_id": post_id, "final_score": final_score}

# ฟังก์ชันสำหรับคำนวณค่า RMSE และ Accuracy ด้วย Cross-validation
def evaluate_model_with_cross_validation():
    data = load_data_from_csv()

    # โหลดโมเดลที่บันทึกจากไฟล์ก่อนหน้า
    collaborative_model = joblib.load('collaborative_model.pkl')
    cosine_sim = joblib.load('cosine_similarity.pkl')
    
    # โหลดข้อมูลที่ใช้ในการฝึกและทดสอบ
    reader = Reader(rating_scale=(data['total_interaction_score'].min(), data['total_interaction_score'].max()))
    interaction_data = Dataset.load_from_df(data[['user_id', 'post_id', 'total_interaction_score']], reader)
    
    # ทำ Cross-validation สำหรับ SVD (Collaborative Filtering)
    results = cross_validate(collaborative_model, interaction_data, measures=['RMSE', 'MAE'], cv=5, verbose=True)
    
    # แสดงผลการประเมินผล
    print(f"Cross-validation results:")
    avg_rmse = results['test_rmse'].mean()
    avg_mae = results['test_mae'].mean()

    # คำนวณความแม่นยำจาก RMSE และ MAE
    accuracy_rmse = 100 - avg_rmse
    accuracy_mae = 100 - avg_mae
    
    print(f"Average RMSE: {avg_rmse}")
    print(f"Average MAE: {avg_mae}")
    print(f"Accuracy based on RMSE: {accuracy_rmse:.2f}%")
    print(f"Accuracy based on MAE: {accuracy_mae:.2f}%")

    return results

# เรียกใช้ฟังก์ชัน evaluate_model_with_cross_validation เพื่อดูค่าความแม่นยำ
evaluate_model_with_cross_validation()
