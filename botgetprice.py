
import requests
import time
import os
import threading
import re
import traceback
import json
import joblib
import pandas as pd
import jwt
import random
import sys
import pickle
import threading
import time
import matplotlib.pyplot as plt
import seaborn as sns
import pandas as pd
import joblib
import numpy as np

from datetime import datetime, timezone
from sqlalchemy import create_engine
from sqlalchemy.sql import text
from flask_sqlalchemy import SQLAlchemy
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.model_selection import train_test_split
from sklearn.neighbors import NearestNeighbors
from pythainlp.tokenize import word_tokenize
from sklearn.metrics import confusion_matrix
from surprise import SVD, Dataset, Reader
from sqlalchemy import create_engine
from textblob import TextBlob
from flask import Flask, jsonify
from sqlalchemy.sql import text
from pythainlp import word_tokenize
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from surprise import SVD, Dataset, Reader
from functools import wraps
from functools import wraps
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from bs4 import BeautifulSoup


app = Flask(__name__)

# สร้าง Chrome options
chrome_options = Options()
chrome_options.add_argument("--headless")  # รันแบบไม่มี UI
chrome_options.add_argument("--disable-gpu")  # ปิดการใช้ GPU (สำหรับ Linux)
chrome_options.add_argument("--no-sandbox")  # ปิด sandbox (จำเป็นใน Docker)
chrome_options.add_argument("--disable-dev-shm-usage")  # ลดการใช้ shared memory (แก้ไขปัญหาใน Docker)
chrome_options.add_argument("--window-size=1920x1080")  # ตั้งขนาดหน้าต่าง
chrome_options.add_argument("--log-level=3")  # ลดการแสดง log
chrome_driver_path = os.path.join(os.getcwd(), "chromedriver", "chromedriver.exe")
# chrome_service = Service(chrome_driver_path)
chrome_service = Service('/usr/bin/chromedriver')
driver = webdriver.Chrome(service=chrome_service, options=chrome_options)

# Filter products by name to match search term
def filter_products_by_name(products, search_name):
    filtered_products = []
    search_name_lower = search_name.lower()
    for product in products:
        product_name_lower = product['name'].lower()
        if re.search(search_name_lower, product_name_lower):
            filtered_products.append(product)
    return filtered_products[:1] if filtered_products else products[:1]

# Search and scrape Advice products
def search_and_scrape_advice_product(product_name, results):
    try:
        search_url = f"https://www.advice.co.th/search?keyword={product_name.replace(' ', '%20')}"
        driver.get(search_url)
        time.sleep(2)
        soup = BeautifulSoup(driver.page_source, 'html.parser')
        
        # ปรับการดึงข้อมูลสินค้าให้เฉพาะเจาะจงมากขึ้น
        product_divs = soup.find_all('div', {'class': 'item'})  
        products = []
        for product_div in product_divs:
            product_name = product_div.get('item-name')
            
            # เงื่อนไขตรวจสอบว่าในชื่อสินค้าต้องมีคำว่า "iPhone" และ "15 Pro"
            if product_name and "iphone" in product_name.lower() and "15 pro" in product_name.lower():
                price_tag = product_div.find('div', {'class': 'sales-price sales-price-font'})
                product_price = price_tag.text.strip() if price_tag else "Price not found"
                product_url = product_div.find('a', {'class': 'product-item-link'})['href']
                products.append({"name": product_name, "price": product_price, "url": product_url})
                
        # กรองข้อมูลสินค้าให้ได้เฉพาะสินค้าที่ตรงกับคำค้นหามากที่สุด
        results['Advice'] = filter_products_by_name(products, product_name) if products else [{"name": "Not found", "price": "-", "url": "#"}]
    except Exception as e:
        results['Advice'] = f"Error occurred during Advice scraping: {e}"


# Scrape JIB
def search_and_scrape_jib_product_from_search(product_name, results):
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'}
    try:
        search_url = f"https://www.jib.co.th/web/product/product_search/0?str_search={product_name.replace(' ', '%20')}"
        response = requests.get(search_url, headers=headers)
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, 'html.parser')
            product_containers = soup.find_all('div', {'class': 'divboxpro'})
            products = []
            for product_container in product_containers:
                product_name_tag = product_container.find('span', {'class': 'promo_name'})
                found_product_name = product_name_tag.text.strip() if product_name_tag else "Product name not found"
                if re.search(product_name.lower(), found_product_name.lower()):  # Check for matching name
                    price_tag = product_container.find('p', {'class': 'price_total'})
                    product_price = price_tag.text.strip() + " บาท" if price_tag else "Price not found"
                    productsearch = product_container.find('div', {'class': 'row size_img center'})
                    product_url = productsearch.find('a')['href']
                    products.append({"name": found_product_name, "price": product_price, "url": product_url})
            results['JIB'] = filter_products_by_name(products, product_name)
        else:
            results['JIB'] = f"Failed to search JIB. Status code: {response.status_code}"
    except Exception as e:
        results['JIB'] = f"Error occurred during JIB scraping: {e}"

# Scrape Banana IT
def search_and_scrape_banana_product(product_name, results):
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'}
    try:
        search_url = f"https://www.bnn.in.th/th/p?q={product_name.replace(' ', '%20')}&ref=search-result"
        response = requests.get(search_url, headers=headers)
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, 'html.parser')
            product_list = soup.find('div', {'class': 'product-list'})
            if not product_list:
                results['Banana'] = []

            product_items = product_list.find_all('a', {'class': 'product-link verify product-item'})
            products = []
            for item in product_items:
                product_url = "https://www.bnn.in.th" + item['href']
                product_name_tag = item.find('div', {'class': 'product-name'})
                found_product_name = product_name_tag.text.strip() if product_name_tag else "Product name not found"
                if re.search(product_name.lower(), found_product_name.lower()):  # Check for matching name
                    price_tag = item.find('div', {'class': 'product-price'})
                    product_price = price_tag.text.strip() if price_tag else "Price not found"
                    products.append({"name": found_product_name, "price": product_price, "url": product_url})
            results['Banana'] = filter_products_by_name(products, product_name)
        else:
            results['Banana'] = f"Failed to search Banana IT. Status code: {response.status_code}"
    except Exception as e:
        results['Banana'] = f"Error occurred during Banana IT scraping: {e}"

# Flask route for searching multiple products
@app.route('/ai/search', methods=['GET'])
def search_product():
    product_name = request.args.get('productname')
    if not product_name:
        return jsonify({"error": "Please provide a product name"}), 400

    results = {product_name: {}}

    # สร้าง thread สำหรับการดึงข้อมูลจากแต่ละร้าน
    threads = []
    threads.append(threading.Thread(target=search_and_scrape_advice_product, args=(product_name, results[product_name])))
    threads.append(threading.Thread(target=search_and_scrape_jib_product_from_search, args=(product_name, results[product_name])))
    threads.append(threading.Thread(target=search_and_scrape_banana_product, args=(product_name, results[product_name])))

    # รัน threads
    for thread in threads:
        thread.start()

    # รอให้ทุก thread ทำงานเสร็จ
    for thread in threads:
        thread.join()

    return jsonify(results)

# Configure your database URI
app.config['SQLALCHEMY_DATABASE_URI'] = 'mysql+mysqlconnector://bestpick_user:bestpick7890@localhost/reviewapp'

# Initialize the SQLAlchemy object
db = SQLAlchemy(app)

load_dotenv()
# Secret key for encoding/decoding JWT tokens
JWT_SECRET = os.getenv('JWT_SECRET')


def verify_token(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            return jsonify({"error": "No token provided or incorrect format"}), 403

        token = auth_header.split(" ")[1]
        try:
            decoded = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            request.user_id = decoded.get("id")
            request.role = decoded.get("role")
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Unauthorized: Token has expired"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "Unauthorized: Invalid token"}), 401

        return f(*args, **kwargs)

    return decorated_function

def load_data_from_db():
    """โหลดข้อมูลจากฐานข้อมูล MySQL และส่งคืนเป็น DataFrame"""
    try:
        engine = create_engine('mysql+mysqlconnector://bestpick_user:bestpick7890@localhost/reviewapp')
        
        query_content = "SELECT * FROM contentbasedview;"
        content_based_data = pd.read_sql(query_content, con=engine)
        print("โหลดข้อมูล Content-Based สำเร็จ")
        
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

def normalize_engagement(data, user_column='owner_id', engagement_column='PostEngagement'):
    """ปรับ Engagement ให้เหมาะสมตามผู้ใช้แต่ละคนให้อยู่ในช่วง [0, 1]"""
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
                # หากเป็นภาษาไทย ให้ tokenize ด้วย PyThaiNLP
                if any('\u0E00' <= char <= '\u0E7F' for char in comment):
                    tokenized_comment = ' '.join(word_tokenize(comment, engine='newmm'))
                else:
                    tokenized_comment = comment

                # คำนวณ Sentiment ด้วย TextBlob
                blob = TextBlob(tokenized_comment)
                polarity = blob.sentiment.polarity
                
                # กำหนด Sentiment Score
                if polarity > 0.5:
                    sentiment_scores.append(1)  # Sentiment บวก
                elif 0 < polarity <= 0.5:
                    sentiment_scores.append(0.5)  # Sentiment บวก
                elif -0.5 <= polarity < 0:
                    sentiment_scores.append(-0.5)  # Sentiment ลบ
                else:
                    sentiment_scores.append(-1)  # Sentiment ลบ
                    
        except Exception as e:
            sentiment_scores.append(0)  # หากเกิดข้อผิดพลาด ให้คะแนนเป็น 0
    return sentiment_scores

def create_content_based_model(data, text_column='Content', comment_column='Comments', engagement_column='PostEngagement'):
    """สร้างโมเดล Content-Based Filtering ด้วย TF-IDF และ KNN พร้อมแบ่งข้อมูล"""
    required_columns = [text_column, comment_column, engagement_column]
    if not all(col in data.columns for col in required_columns):
        raise ValueError(f"ข้อมูลขาดคอลัมน์ที่จำเป็น: {set(required_columns) - set(data.columns)}")

    # แบ่งข้อมูลเป็น train และ test
    train_data, test_data = train_test_split(data, test_size=0.25, random_state=42)

    # ใช้ TF-IDF เพื่อแปลงเนื้อหาของโพสต์เป็นเวกเตอร์
    tfidf = TfidfVectorizer(stop_words='english', max_features=6000, ngram_range=(1, 3), min_df=1, max_df=0.8)
    tfidf_matrix = tfidf.fit_transform(train_data[text_column].fillna(''))

    # ใช้ KNN เพื่อหาความคล้ายคลึงระหว่างโพสต์
    knn = NearestNeighbors(n_neighbors=10, metric='cosine')
    knn.fit(tfidf_matrix)

    # วิเคราะห์ความรู้สึกจากความคิดเห็นใน train และ test sets
    train_data['SentimentScore'] = analyze_comments(train_data[comment_column])
    test_data['SentimentScore'] = analyze_comments(test_data[comment_column])

    # ปรับ Engagement ใน train set
    train_data = normalize_engagement(train_data)
    train_data['NormalizedEngagement'] = normalize_scores(train_data[engagement_column])
    train_data['WeightedEngagement'] = train_data['NormalizedEngagement'] + train_data['SentimentScore']

    # ปรับ Engagement ใน test set (กรณีใช้ในการประเมิน)
    test_data = normalize_engagement(test_data)

    joblib.dump(tfidf, 'TFIDF_Model.pkl')
    joblib.dump(knn, 'KNN_Model.pkl')
    return tfidf, knn, train_data, test_data

def create_collaborative_model(data, n_factors=150, n_epochs=70, lr_all=0.005, reg_all=0.5):
    """สร้างและฝึกโมเดล Collaborative Filtering พร้อมแบ่งข้อมูลเป็น training และ test set"""
    required_columns = ['user_id', 'post_id']
    if not all(col in data.columns for col in required_columns):
        raise ValueError(f"ข้อมูลขาดคอลัมน์ที่จำเป็น: {set(required_columns) - set(data.columns)}")

    melted_data = data.melt(id_vars=['user_id', 'post_id'], var_name='category', value_name='score')
    melted_data = melted_data[melted_data['score'] > 0]

    train_data, test_data = train_test_split(melted_data, test_size=0.25, random_state=42)

    reader = Reader(rating_scale=(melted_data['score'].min(), melted_data['score'].max()))
    trainset = Dataset.load_from_df(train_data[['user_id', 'post_id', 'score']], reader).build_full_trainset()

    model = SVD(n_factors=n_factors, n_epochs=n_epochs, lr_all=lr_all, reg_all=reg_all)
    model.fit(trainset)

    joblib.dump(model, 'Collaborative_Model.pkl')
    return model, test_data

def recommend_hybrid(user_id, train_data, test_data, collaborative_model, knn, tfidf, categories, alpha=0.50, beta=0.20):
    """
    แนะนำโพสต์โดยใช้ Hybrid Filtering รวม Collaborative, Content-Based และ Categories Adjustment
    :param alpha: น้ำหนักของคะแนน Collaborative (0 ถึง 1)
    :param beta: น้ำหนักของคะแนน Categories (0 ถึง 1)
    """
    if not (0 <= alpha <= 1):
        raise ValueError("Alpha ต้องอยู่ในช่วง 0 ถึง 1")
    if not (0 <= beta <= 1):
        raise ValueError("Beta ต้องอยู่ในช่วง 0 ถึง 1")

    recommendations = []

    # ใช้ test_data ทั้งหมด
    for _, post in test_data.iterrows():
        # Collaborative Filtering
        collab_score = collaborative_model.predict(user_id, post['post_id']).est

        # Content-Based Filtering
        idx = train_data.index[train_data['post_id'] == post['post_id']].tolist()
        content_score = 0
        if idx:
            idx = idx[0]
            tfidf_vector = tfidf.transform([train_data.iloc[idx]['Content']])
            n_neighbors = min(20, knn._fit_X.shape[0])
            distances, indices = knn.kneighbors(tfidf_vector, n_neighbors=n_neighbors)
            content_score = np.mean([train_data.iloc[i]['NormalizedEngagement'] for i in indices[0]])

        # Categories Adjustment
        category_score = 0
        if categories:
            for category in categories:
                if category in post and post[category] == 1:  # เช็คว่าหมวดหมู่ตรงหรือไม่
                    category_score += 1

        # Normalize Category Score
        if categories:
            category_score /= len(categories)

        # Hybrid Score
        final_score = (alpha * collab_score) + ((1 - alpha) * content_score) + (beta * category_score)
        recommendations.append((post['post_id'], final_score))

    # Normalize Scores
    recommendations_df = pd.DataFrame(recommendations, columns=['post_id', 'score'])
    recommendations_df['normalized_score'] = normalize_scores(recommendations_df['score'])
    return recommendations_df.sort_values(by='normalized_score', ascending=False)['post_id'].tolist()


def split_and_rank_recommendations(recommendations, user_interactions):
    """แยกโพสต์ที่ผู้ใช้เคยโต้ตอบออกจากโพสต์ที่ยังไม่เคยดู และเรียงลำดับใหม่"""
    # แปลง recommendations ให้ไม่มีโพสต์ซ้ำ
    unique_recommendations = list(dict.fromkeys(recommendations))

    # แยกโพสต์ที่ผู้ใช้ยังไม่เคยดู และโพสต์ที่ผู้ใช้เคยโต้ตอบแล้ว
    unviewed_posts = [post_id for post_id in unique_recommendations if post_id not in user_interactions]
    viewed_posts = [post_id for post_id in unique_recommendations if post_id in user_interactions]

    # รวมโพสต์ที่ยังไม่เคยดู (unviewed) ก่อน ตามด้วยโพสต์ที่เคยดูแล้ว (viewed)
    final_recommendations = unviewed_posts + viewed_posts

    # พิมพ์ข้อมูลออกมา
    print("Unviewed Posts:", unviewed_posts)
    print("Viewed Posts:", viewed_posts)
    print("Final Recommendations (ordered):", final_recommendations)

    return final_recommendations

# Cache สำหรับเก็บคำแนะนำของผู้ใช้
recommendation_cache = {}
cache_expiry_time = 10  # หน่วยเป็นวินาที (10 วินาที)

# ฟังก์ชันสำหรับ clear cache
def clear_cache():
    """เคลียร์ cache ทุกๆ 10 วินาที"""
    global recommendation_cache
    while True:
        time.sleep(cache_expiry_time)  # รอ 10 วินาที
        recommendation_cache = {}
        print("Cache cleared automatically.")

# สร้าง thread สำหรับ clear cache
threading.Thread(target=clear_cache, daemon=True).start()

@app.route('/ai/recommend', methods=['POST'])
@verify_token
def recommend():
    try:
        user_id = request.user_id

        # หาก cache มีผลลัพธ์สำหรับ user_id นี้ ให้ใช้ผลลัพธ์จาก cache
        if user_id in recommendation_cache:
            print(f"Returning cached recommendations for user_id: {user_id}")
            return jsonify(recommendation_cache[user_id])

        # โหลดข้อมูลจากฐานข้อมูล
        content_based_data, collaborative_data = load_data_from_db()

        # สร้างคอลัมน์ 'NormalizedEngagement' หากยังไม่มี
        if 'NormalizedEngagement' not in content_based_data.columns:
            content_based_data = normalize_engagement(content_based_data, user_column='owner_id', engagement_column='PostEngagement')

        # Load pre-trained models
        try:
            knn = joblib.load('KNN_Model.pkl')
            collaborative_model = joblib.load('Collaborative_Model.pkl')
            tfidf = joblib.load('TFIDF_Model.pkl')
        except FileNotFoundError as e:
            print(f"Error loading models: {e}")
            return jsonify({"error": "Model files not found"}), 500

        # สร้างหมวดหมู่
        categories = [
            'Gadget', 'Smartphone', 'Laptop', 'Smartwatch', 'Headphone', 'Tablet', 'Camera', 'Drone',
            'Home_Appliance', 'Gaming_Console', 'Wearable_Device', 'Fitness_Tracker', 'VR_Headset',
            'Smart_Home', 'Power_Bank', 'Bluetooth_Speaker', 'Action_Camera', 'E_Reader',
            'Desktop_Computer', 'Projector'
        ]

        # คำนวณคำแนะนำใหม่
        recommendations = recommend_hybrid(
            user_id, content_based_data, collaborative_data,
            collaborative_model, knn, tfidf, categories,
            alpha=0.8, beta=0.2  # เพิ่ม beta สำหรับ categories
        )

        if not recommendations:
            return jsonify({"error": "No recommendations found"}), 404

        # แยกโพสต์ที่ผู้ใช้เคยโต้ตอบ และยังไม่เคยดู
        user_interactions = collaborative_data[collaborative_data['user_id'] == user_id]['post_id'].tolist()
        final_recommendations = split_and_rank_recommendations(recommendations, user_interactions)

        # Query for post details
        placeholders = ', '.join([f':id_{i}' for i in range(len(final_recommendations))])
        query = text(f"""
            SELECT posts.*, users.username, users.picture,
                   (SELECT COUNT(*) FROM likes WHERE post_id = posts.id AND user_id = :user_id) AS is_liked
            FROM posts 
            JOIN users ON posts.user_id = users.id
            WHERE posts.status = 'active' AND posts.id IN ({placeholders})
        """)

        params = {'user_id': user_id, **{f'id_{i}': post_id for i, post_id in enumerate(final_recommendations)}}
        result = db.session.execute(query, params).fetchall()
        posts = [row._mapping for row in result]

        # ใช้ final_recommendations เพื่อรักษาลำดับที่แนะนำ
        sorted_posts = sorted(posts, key=lambda x: final_recommendations.index(x['id']))

        output = []
        for post in sorted_posts:
            output.append({
                "id": post['id'],
                "userId": post['user_id'],
                "title": post['Title'],
                "content": post['content'],
                "updated": post['updated_at'].astimezone(timezone.utc).replace(microsecond=0).isoformat() + 'Z',
                "photo_url": json.loads(post.get('photo_url', '[]')),
                "video_url": json.loads(post.get('video_url', '[]')),
                "userName": post['username'],
                "userProfileUrl": post['picture'],
                "is_liked": post['is_liked'] > 0
            })

        # บันทึกผลลัพธ์ลงใน cache
        recommendation_cache[user_id] = output

        return jsonify(output)

    except KeyError as e:
        print(f"KeyError in recommend function: {e}")
        return jsonify({"error": f"KeyError: {e}"}), 500
    except Exception as e:
        print("Error in recommend function:", e)
        return jsonify({"error": "Internal Server Error"}), 500

if __name__ == '__main__':
        app.run(host='0.0.0.0', port=5005)