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


app = Flask(__name__)

# Set up Selenium driver
chrome_options = Options()
chrome_options.add_argument("--headless")
chrome_options.add_argument("--disable-gpu")
chrome_options.add_argument("--no-sandbox")
chrome_options.add_argument("--disable-dev-shm-usage")
chrome_options.add_argument("--window-size=1920x1080")
chrome_options.add_argument("--log-level=3")
chrome_driver_path = os.getenv('CHROME_DRIVER_PATH', "C:/chromedriver/chromedriver.exe")
chrome_service = Service(chrome_driver_path)
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
        time.sleep(3)
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
@app.route('/search', methods=['GET'])
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

# โหลดโมเดล SVD และ TF-IDF พร้อมกับ cosine similarity
collaborative_model = joblib.load('collaborative_model.pkl')
tfidf = joblib.load('tfidf_model.pkl')
tfidf_matrix = joblib.load('tfidf_matrix.pkl')
cosine_sim = joblib.load('cosine_similarity.pkl')

def load_data_from_db():
    # สร้าง engine สำหรับ SQLAlchemy
    engine = create_engine('mysql+mysqlconnector://root:1234@localhost/ReviewAPP')
    
    # ดึงข้อมูลจากฐานข้อมูล
    query = "SELECT * FROM clean_new_view;"
    data = pd.read_sql(query, con=engine)  
    return data

# ฟังก์ชันสำหรับแนะนำโพสต์ตามเนื้อหาที่คล้ายกัน
def content_based_recommendations(post_id, user_id, cosine_sim=cosine_sim):
    data = load_data_from_db()  # โหลดข้อมูลใหม่ทุกครั้ง
    try:
        idx = data.index[data['post_id'] == post_id][0]
        sim_scores = list(enumerate(cosine_sim[idx]))
        sim_scores = sorted(sim_scores, key=lambda x: x[1], reverse=True)
        sim_scores = sim_scores[1:11]  # แนะนำโพสต์ที่คล้ายที่สุด 10 อันดับแรก
        post_indices = [i[0] for i in sim_scores]
        
        # ตรวจสอบโพสต์ที่คล้ายกัน
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

# ฟังก์ชันสำหรับแนะนำโพสต์ให้ผู้ใช้ โดยเรียงลำดับโพสต์ตามคะแนนจากมากไปน้อย
def recommend_posts_for_user(user_id, alpha=0.7):
    data = load_data_from_db()  # โหลดข้อมูลใหม่ทุกครั้ง
    post_scores = []

    # ตรวจสอบข้อมูลใน DataFrame
    print("DataFrame Preview:")
    print(data[['post_id', 'post_content', 'category_name']].head(10))
    
    # ตรวจสอบขนาดของ TF-IDF Matrix
    print("TF-IDF Matrix Shape:", tfidf_matrix.shape)
    
    # ตรวจสอบค่า Cosine Similarity
    print("Cosine Similarity Sample:", cosine_sim[:5, :5])  # ดูค่าบางส่วน

    # วนผ่านโพสต์ทั้งหมดเพื่อคำนวณคะแนนการแนะนำ
    for post_id in data['post_id'].unique():
        score = hybrid_recommendations(user_id, post_id, alpha=alpha)
        post_scores.append((int(score['post_id']), float(score['final_score'])))  # แปลงเป็น int และ float เพื่อความปลอดภัยในการ serialize
    
    # เรียงลำดับโพสต์ตามคะแนนจากมากไปน้อย
    post_scores = sorted(post_scores, key=lambda x: x[1], reverse=True)
    
    # สุ่มเลือก 10 โพสต์จากโพสต์ที่มีคะแนนสูงสุด
    if len(post_scores) > 10:
        post_scores = random.sample(post_scores, 10)
    
    print("Recommended Post Scores:", post_scores)  # แสดงผลคะแนนการแนะนำโพสต์
    
    return post_scores

# Configure your database URI
app.config['SQLALCHEMY_DATABASE_URI'] = 'mysql+mysqlconnector://root:1234@localhost/ReviewAPP'

# Initialize the SQLAlchemy object
db = SQLAlchemy(app)
# API endpoint สำหรับแนะนำโพสต์ให้ผู้ใช้
load_dotenv()
# Secret key for encoding/decoding JWT tokens (make sure to keep it secure)
JWT_SECRET = os.getenv('JWT_SECRET')

def verify_token(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Get the Authorization header
        auth_header = request.headers.get("Authorization")

        if not auth_header or not auth_header.startswith("Bearer "):
            return jsonify({"error": "No token provided or incorrect format"}), 403

        # Extract the token part from "Bearer <token>"
        token = auth_header.split(" ")[1]

        try:
            # Decode the token using JWT_SECRET
            decoded = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
            # Add user ID and role to the request context
            request.user_id = decoded.get("id")
            request.role = decoded.get("role")
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Unauthorized: Token has expired"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "Unauthorized: Invalid token"}), 401

        return f(*args, **kwargs)

    return decorated_function


@app.route('/recommend', methods=['POST'])
@verify_token
def recommend():
    user_id = request.user_id
    post_scores = recommend_posts_for_user(user_id)
    post_ids = [post_id for post_id, _ in post_scores]

    if not post_ids:
        return jsonify({"error": "No recommendations found"}), 404

    placeholders = ', '.join([f':id_{i}' for i in range(len(post_ids))])
    query = text(f"""
        SELECT posts.*, users.username, users.picture, 
               (SELECT COUNT(*) FROM likes WHERE post_id = posts.id AND user_id = :user_id) AS is_liked
        FROM posts 
        JOIN users ON posts.user_id = users.id
        WHERE posts.status = 'active' AND posts.id IN ({placeholders})
    """)

    params = {'user_id': user_id, **{f'id_{i}': post_id for i, post_id in enumerate(post_ids)}}
    result = db.session.execute(query, params).fetchall()
    posts = [row._mapping for row in result]

    recommendations = [
        {
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
        } for post in posts
    ]

    return jsonify(recommendations)


if __name__ == '__main__':
    try:
        app.run(host='0.0.0.0', port=5000)

    finally:
        driver.quit()
