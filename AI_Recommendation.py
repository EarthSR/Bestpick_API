import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from surprise import SVD, Dataset, Reader
import joblib
import numpy as np
from textblob import TextBlob
from pythainlp.tokenize import word_tokenize
import matplotlib.pyplot as plt
from sklearn.metrics import confusion_matrix
import seaborn as sns
from sqlalchemy import create_engine

def load_data_from_db():
    """โหลดข้อมูลจากฐานข้อมูล MySQL และส่งคืนเป็น DataFrame"""
    try:
        # สร้างการเชื่อมต่อกับฐานข้อมูล
        engine = create_engine('mysql+mysqlconnector://root:1234@localhost/reviewapp')
        
        # Query สำหรับข้อมูล Content-Based
        query_content = "SELECT * FROM contentbasedview;"
        content_based_data = pd.read_sql(query_content, con=engine)
        print("โหลดข้อมูล Content-Based สำเร็จ")
        
        # Query สำหรับข้อมูล Collaborative
        query_collaborative = "SELECT * FROM collaborativeview;"
        collaborative_data = pd.read_sql(query_collaborative, con=engine)
        print("โหลดข้อมูล Collaborative สำเร็จ")
        
        return content_based_data, collaborative_data
    except Exception as e:
        print(f"ข้อผิดพลาดในการโหลดข้อมูลจากฐานข้อมูล: {str(e)}")
        raise


def normalize_scores(series):
    """ทำให้คะแนนอยู่ในช่วง [0, 1]"""
    min_val, max_val = series.min(), series.max()
    if max_val > min_val:
        return (series - min_val) / (max_val - min_val)
    return series

def normalize_engagement(data, user_column='owner_id', engagement_column='WeightedEngagement'):
    """ปรับ Engagement ให้เหมาะสมตามผู้ใช้แต่ละคน"""
    data['NormalizedEngagement'] = data.groupby(user_column)[engagement_column].transform(lambda x: normalize_scores(x))
    return data

def analyze_comments(comments):
    """วิเคราะห์ความรู้สึกของคอมเมนต์ รองรับทั้งภาษาไทยและภาษาอังกฤษ"""
    sentiment_scores = []
    for comment in comments:
        try:
            if pd.isna(comment):
                sentiment_scores.append(0)
            else:
                # ตรวจสอบว่าเป็นภาษาไทยหรือไม่
                if any('\u0E00' <= char <= '\u0E7F' for char in comment):  # เช็คอักขระไทย
                    tokenized_comment = ' '.join(word_tokenize(comment, engine='newmm'))
                else:
                    tokenized_comment = comment

                blob = TextBlob(tokenized_comment)
                polarity = blob.sentiment.polarity  # ช่วงค่า -1 ถึง 1
                if polarity > 0.5:
                    sentiment_scores.append(3)  # เชิงบวกแรง
                elif 0 < polarity <= 0.5:
                    sentiment_scores.append(1)  # เชิงบวกเบา
                elif -0.5 <= polarity < 0:
                    sentiment_scores.append(-1)  # เชิงลบเบา
                else:
                    sentiment_scores.append(-3)  # เชิงลบแรง
        except Exception as e:
            sentiment_scores.append(0)  # กรณีผิดพลาดใช้ค่ากลาง
    return sentiment_scores

def create_collaborative_model(data, n_factors=150, n_epochs=70, lr_all=0.004, reg_all=0.02):
    """สร้างและฝึกโมเดล Collaborative Filtering"""
    required_columns = ['user_id', 'post_id']
    if not all(col in data.columns for col in required_columns):
        raise ValueError(f"ข้อมูลขาดคอลัมน์ที่จำเป็น: {set(required_columns) - set(data.columns)}")

    melted_data = data.melt(id_vars=['user_id', 'post_id'], var_name='category', value_name='score')
    melted_data = melted_data[melted_data['score'] > 0]

    reader = Reader(rating_scale=(melted_data['score'].min(), melted_data['score'].max()))
    interaction_data = Dataset.load_from_df(melted_data[['user_id', 'post_id', 'score']], reader)

    trainset = interaction_data.build_full_trainset()
    model = SVD(n_factors=n_factors, n_epochs=n_epochs, lr_all=lr_all, reg_all=reg_all)
    model.fit(trainset)

    joblib.dump(model, 'Collaborative_Model.pkl')
    return model

def create_content_based_model(data, text_column='Content', comment_column='Comments', engagement_column='PostEngagement'):
    """สร้างโมเดล Content-Based Filtering ด้วย TF-IDF และ Cosine Similarity"""
    required_columns = [text_column, comment_column, engagement_column]
    if not all(col in data.columns for col in required_columns):
        raise ValueError(f"ข้อมูลขาดคอลัมน์ที่จำเป็น: {set(required_columns) - set(data.columns)}")

    tfidf = TfidfVectorizer(stop_words='english', max_features=6000, ngram_range=(1, 3), min_df=1, max_df=0.8)
    tfidf_matrix = tfidf.fit_transform(data[text_column].fillna(''))

    cosine_sim = cosine_similarity(tfidf_matrix, tfidf_matrix)

    data['SentimentScore'] = analyze_comments(data[comment_column])

    # ปรับ WeightedEngagement รวม PostEngagement (75%) และ Sentiment (25%)
    data['WeightedEngagement'] = 0.75 * data[engagement_column] + 0.25 * normalize_scores(pd.Series(data['SentimentScore']))
    data = normalize_engagement(data)

    joblib.dump(tfidf, 'TFIDF_Model.pkl')
    joblib.dump(cosine_sim, 'Cosine_Similarity.pkl')
    return tfidf, cosine_sim, data

def recommend_hybrid(user_id, data, collaborative_data, collaborative_model, cosine_sim, categories, alpha=0.9):
    """แนะนำโพสต์โดยใช้ Hybrid Filtering รวม Collaborative และ Content-Based"""
    if not (0 <= alpha <= 1):
        raise ValueError("Alpha ต้องอยู่ในช่วง 0 ถึง 1")

    # ค้นหาโพสต์ที่ผู้ใช้เคยมีปฏิสัมพันธ์
    user_interactions = collaborative_data[collaborative_data['user_id'] == user_id]['post_id'].tolist()

    # ลบโพสต์ที่ user_id หรือ owner_id ที่เกี่ยวข้อง
    interacted_posts = data[data['owner_id'] == user_id]['post_id'].tolist()
    unviewed_data = data[~data['post_id'].isin(interacted_posts)]

    recommendations = []
    for category in categories:
        category_data = unviewed_data[unviewed_data[category] == 1]
        for _, post in category_data.iterrows():
            collab_score = collaborative_model.predict(user_id, post['post_id']).est
            collab_normalized = normalize_scores(pd.Series([collab_score])).iloc[0]

            idx = data.index[data['post_id'] == post['post_id']].tolist()
            content_score = 0
            if idx:
                idx = idx[0]
                sim_scores = list(enumerate(cosine_sim[idx]))
                sim_scores = sorted(sim_scores, key=lambda x: x[1], reverse=True)
                content_score = sum(data.iloc[i[0]]['NormalizedEngagement'] for i in sim_scores[:20]) / 20

            content_normalized = normalize_scores(pd.Series([content_score])).iloc[0]

            # รวมคะแนนจาก Collaborative และ Content-Based
            final_score = alpha * collab_normalized + (1 - alpha) * content_normalized
            recommendations.append((post['post_id'], final_score))

    recommendations_df = pd.DataFrame(recommendations, columns=['post_id', 'score'])
    recommendations_df['normalized_score'] = normalize_scores(recommendations_df['score'])

    # แยกโพสต์ที่ผู้ใช้เคยปฏิสัมพันธ์
    interacted_df = recommendations_df[recommendations_df['post_id'].isin(user_interactions)]
    new_posts_df = recommendations_df[~recommendations_df['post_id'].isin(user_interactions)]

    # เรียงลำดับใหม่: โพสต์ใหม่ก่อน โพสต์ที่เคยมีปฏิสัมพันธ์ทีหลัง
    new_posts_df = new_posts_df.sort_values(by='normalized_score', ascending=False)
    interacted_df = interacted_df.sort_values(by='normalized_score', ascending=False)

    # รวมผลลัพธ์
    recommendations = pd.concat([new_posts_df, interacted_df])['post_id'].tolist()

    return recommendations

def evaluate_model(data, recommendations, threshold=0.5):
    """ประเมินผลโมเดลด้วย Precision, Recall และ F1-Score"""
    relevant_items = data[(data['PostEngagement'] > threshold) & (data['SentimentScore'] > -1)]['post_id'].tolist()
    recommended_items = recommendations

    tp = set(recommended_items) & set(relevant_items)
    fp = set(recommended_items) - tp
    fn = set(relevant_items) - tp

    precision = len(tp) / (len(tp) + len(fp)) if (len(tp) + len(fp)) > 0 else 0
    recall = len(tp) / (len(tp) + len(fn)) if (len(tp) + len(fn)) > 0 else 0
    f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0

    return precision, recall, f1, list(tp), list(fp), list(fn)

def plot_evaluation_results(results):
    """วาดกราฟผลการประเมิน Precision, Recall และ F1"""
    metrics = ['Precision', 'Recall', 'F1']
    averages = [
        np.mean([r[0] for r in results]),
        np.mean([r[1] for r in results]),
        np.mean([r[2] for r in results])
    ]

    plt.figure(figsize=(8, 5))
    plt.bar(metrics, averages, color=['blue', 'green', 'red'])
    plt.ylim(0, 1)
    plt.title('Evaluation Metrics')
    plt.ylabel('Score')
    plt.xlabel('Metrics')
    plt.xticks(rotation=45)
    plt.grid(axis='y', linestyle='--', alpha=0.7)
    plt.tight_layout()
    plt.savefig('evaluation_metrics.png')
    plt.show()
    print("กราฟผลการประเมินถูกบันทึกใน 'evaluation_metrics.png'")

def plot_confusion_matrix(tp, fp, fn):
    """วาดกราฟ Confusion Matrix"""
    cm = np.array([[len(tp), len(fp)], [len(fn), len(tp)]])
    plt.figure(figsize=(6, 5))
    sns.heatmap(cm, annot=True, fmt='d', cmap='Blues', xticklabels=['Not Recommended', 'Recommended'], yticklabels=['Not Recommended', 'Recommended'])
    plt.title('Confusion Matrix for Recommendation System')
    plt.xlabel('Predicted')
    plt.ylabel('True')
    plt.tight_layout()
    plt.savefig('confusion_matrix.png')
    plt.show()
    print("Confusion Matrix ถูกบันทึกใน 'confusion_matrix.png'")

# Main execution
def main():
    # โหลดข้อมูลจากฐานข้อมูล
    content_based_data, collaborative_data = load_data_from_db()

    if collaborative_data is None or content_based_data is None:
        return

    collaborative_model = create_collaborative_model(collaborative_data)
    tfidf, cosine_sim, enriched_content_data = create_content_based_model(content_based_data)

    # หมวดหมู่ตัวอย่าง
    categories = [
        'Gadget', 'Smartphone', 'Laptop', 'Smartwatch', 'Headphone', 'Tablet', 'Camera', 'Drone',
        'Home_Appliance', 'Gaming_Console', 'Wearable_Device', 'Fitness_Tracker', 'VR_Headset',
        'Smart_Home', 'Power_Bank', 'Bluetooth_Speaker', 'Action_Camera', 'E_Reader',
        'Desktop_Computer', 'Projector'
    ]

    user_ids = enriched_content_data['owner_id'].unique()
    results = []
    all_tp, all_fp, all_fn = [], [], []

    for _ in range(10):  # รันซ้ำ 5 รอบเพื่อความเสถียร
        for user_id in user_ids:
            recommendations = recommend_hybrid(user_id, enriched_content_data, collaborative_model, cosine_sim, categories, alpha=0.9)
            precision, recall, f1, tp, fp, fn = evaluate_model(enriched_content_data, recommendations)
            results.append((precision, recall, f1))
            all_tp.extend(tp)
            all_fp.extend(fp)
            all_fn.extend(fn)

    # คำนวณค่าเฉลี่ยของผลการประเมิน
    avg_precision = np.mean([r[0] for r in results])
    avg_recall = np.mean([r[1] for r in results])
    avg_f1 = np.mean([r[2] for r in results])

    print("ผลการประเมินเฉลี่ยหลังจาก 5 รอบ:")
    print(f"Precision: {avg_precision:.2f}")
    print(f"Recall: {avg_recall:.2f}")
    print(f"F1 Score: {avg_f1:.2f}")

    # วาดกราฟผลการประเมิน
    plot_evaluation_results(results)
    plot_confusion_matrix(all_tp, all_fp, all_fn)

    # บันทึกผลการประเมินลงไฟล์ CSV
    results_df = pd.DataFrame(results, columns=['Precision', 'Recall', 'F1'])
    results_df.to_csv('evaluation_results.csv', index=False)
    print("ผลการประเมินถูกบันทึกใน 'evaluation_results.csv'")

    # แสดงผลการแนะนำสำหรับ user_id 1170001
    test_user_id = 1170001
    test_recommendations = recommend_hybrid(test_user_id, enriched_content_data, collaborative_model, cosine_sim, categories, alpha=0.9)
    print(f"โพสต์ที่แนะนำสำหรับ user_id {test_user_id}: {test_recommendations[:10]}")

if __name__ == "__main__":
    main()
