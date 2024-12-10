from flask import Flask, request, jsonify
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from bs4 import BeautifulSoup
import requests
import time
import os
import threading
import re
import traceback
from datetime import datetime, timezone
import json
import joblib
import pandas as pd
from sqlalchemy import create_engine
from sqlalchemy.sql import text
from flask_sqlalchemy import SQLAlchemy
import jwt
from functools import wraps
from dotenv import load_dotenv
import random
import sys
import pickle
from pythainlp import word_tokenize
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from surprise import SVD, Dataset, Reader
from functools import wraps



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
# สร้าง ChromeDriver ด้วย service และ options
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
app.config['SQLALCHEMY_DATABASE_URI'] = 'mysql+mysqlconnector://root:1234@localhost/reviewapp'

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
    engine = create_engine('mysql+mysqlconnector://root:1234@localhost/reviewapp')
    query_content = "SELECT * FROM contentbasedview;"
    query_collaborative = "SELECT * FROM collaborativeview;"

    content_data = pd.read_sql(query_content, con=engine)
    collaborative_data = pd.read_sql(query_collaborative, con=engine)

    return content_data, collaborative_data

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
                if any('\u0E00' <= char <= '\u0E7F' for char in comment):
                    tokenized_comment = ' '.join(word_tokenize(comment, engine='newmm'))
                else:
                    tokenized_comment = comment

                blob = TextBlob(tokenized_comment)
                polarity = blob.sentiment.polarity  # ช่วงค่า -1 ถึง 1
                if polarity > 0.5:
                    sentiment_scores.append(3)
                elif 0 < polarity <= 0.5:
                    sentiment_scores.append(1)
                elif -0.5 <= polarity < 0:
                    sentiment_scores.append(-1)
                else:
                    sentiment_scores.append(-3)
        except Exception as e:
            sentiment_scores.append(0)
    return sentiment_scores

def enrich_content_data(content_data):
    """เพิ่มข้อมูลที่จำเป็นสำหรับ Content-Based Filtering"""
    content_data['SentimentScore'] = analyze_comments(content_data['Comments'])
    content_data['WeightedEngagement'] = 0.75 * content_data['PostEngagement'] + \
                                         0.25 * normalize_scores(pd.Series(content_data['SentimentScore']))
    content_data = normalize_engagement(content_data)
    return content_data

def recommend_hybrid(user_id, data, collaborative_data, collaborative_model, cosine_sim, categories, alpha=0.9):
    """แนะนำโพสต์โดยใช้ Hybrid Filtering รวม Collaborative และ Content-Based"""
    if not (0 <= alpha <= 1):
        raise ValueError("Alpha ต้องอยู่ในช่วง 0 ถึง 1")

    user_interactions = collaborative_data[collaborative_data['user_id'] == user_id]['post_id'].tolist()
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

            final_score = alpha * collab_normalized + (1 - alpha) * content_normalized
            recommendations.append((post['post_id'], final_score))

    recommendations_df = pd.DataFrame(recommendations, columns=['post_id', 'score'])
    recommendations_df['normalized_score'] = normalize_scores(recommendations_df['score'])

    interacted_df = recommendations_df[recommendations_df['post_id'].isin(user_interactions)]
    new_posts_df = recommendations_df[~recommendations_df['post_id'].isin(user_interactions)]

    new_posts_df = new_posts_df.sort_values(by='normalized_score', ascending=False)
    interacted_df = interacted_df.sort_values(by='normalized_score', ascending=False)

    recommendations = pd.concat([new_posts_df, interacted_df])['post_id'].tolist()

    return recommendations

@app.route('/ai/recommend', methods=['POST'])
@verify_token
def recommend():
    try:
        user_id = request.user_id
        content_data, collaborative_data = load_data_from_db()

        # Enrich content_data
        enriched_content_data = enrich_content_data(content_data)

        # Load pre-trained models
        collaborative_model = joblib.load('Collaborative_Model.pkl')
        cosine_sim = joblib.load('Cosine_Similarity.pkl')

        categories = [
            'Gadget', 'Smartphone', 'Laptop', 'Smartwatch', 'Headphone', 'Tablet', 'Camera', 'Drone',
            'Home_Appliance', 'Gaming_Console', 'Wearable_Device', 'Fitness_Tracker', 'VR_Headset',
            'Smart_Home', 'Power_Bank', 'Bluetooth_Speaker', 'Action_Camera', 'E_Reader',
            'Desktop_Computer', 'Projector'
        ]

        # Recommend posts
        recommendations = recommend_hybrid(user_id, enriched_content_data, collaborative_data, collaborative_model, cosine_sim, categories, alpha=0.9)

        if not recommendations:
            return jsonify({"error": "No recommendations found"}), 404

        # แยกโพสต์ที่มีปฏิสัมพันธ์และโพสต์ใหม่
        user_interactions = collaborative_data[collaborative_data['user_id'] == user_id]['post_id'].tolist()
        new_recommendations = [post_id for post_id in recommendations if post_id not in user_interactions]
        interacted_recommendations = [post_id for post_id in recommendations if post_id in user_interactions]

        # **รวมโพสต์ใหม่กับโพสต์ที่เคยมีปฏิสัมพันธ์ โดยยังรักษาโพสต์ที่มีปฏิสัมพันธ์ในตำแหน่งเดิม**
        unique_recommendations = new_recommendations + interacted_recommendations

        # Query for post details
        placeholders = ', '.join([f':id_{i}' for i in range(len(unique_recommendations))])
        query = text(f"""
            SELECT posts.*, users.username, users.picture,
                   (SELECT COUNT(*) FROM likes WHERE post_id = posts.id AND user_id = :user_id) AS is_liked
            FROM posts 
            JOIN users ON posts.user_id = users.id
            WHERE posts.status = 'active' AND posts.id IN ({placeholders})
        """)

        params = {'user_id': user_id, **{f'id_{i}': post_id for i, post_id in enumerate(unique_recommendations)}}
        result = db.session.execute(query, params).fetchall()
        posts = [row._mapping for row in result]

        # ใช้ unique_recommendations เพื่อรักษาลำดับที่แนะนำ
        sorted_posts = sorted(posts, key=lambda x: unique_recommendations.index(x['id']))

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

        return jsonify(output)

    except Exception as e:
        print("Error in recommend function:", e)
        return jsonify({"error": "Internal Server Error"}), 500


if __name__ == '__main__':
        app.run(host='0.0.0.0', port=5005)

 