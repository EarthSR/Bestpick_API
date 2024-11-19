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
import tensorflow as tf
from tensorflow.keras.preprocessing.image import img_to_array, load_img
import numpy as np
from werkzeug.utils import secure_filename
import pymysql
from pythainlp import word_tokenize



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

# โหลดโมเดล SVD และ TF-IDF พร้อมกับ cosine similarity
collaborative_model = joblib.load('collaborative_model.pkl')
tfidf = joblib.load('tfidf_model.pkl')
tfidf_matrix = joblib.load('tfidf_matrix.pkl')
cosine_sim = joblib.load('cosine_similarity.pkl')

def load_data_from_db():
    engine = create_engine('mysql+mysqlconnector://bestpick_user:bestpick7890@localhost/reviewapp')
    query = "SELECT * FROM clean_new_view;"
    return pd.read_sql(query, con=engine)

# ฟังก์ชันสำหรับแนะนำโพสต์ตามเนื้อหาที่คล้ายกัน
def content_based_recommendations(post_id, user_id):
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

    for post_id, score in recommended_posts:
        post_details = data.loc[data['post_id'] == post_id].iloc[0]  # ดึงข้อมูลโพสต์ตาม ID
        print(f"Post ID: {post_id}, Score: {score}, Content: {post_details['post_content']}, Title: {post_details['post_title']}")

    return recommended_posts




# Configure your database URI
app.config['SQLALCHEMY_DATABASE_URI'] = 'mysql+mysqlconnector://bestpick_user:bestpick7890@localhost/reviewapp'

# Initialize the SQLAlchemy object
db = SQLAlchemy(app)

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

sys.stdout.reconfigure(encoding='utf-8')

#แก้6


'''
from flask import Flask, request, jsonify
from werkzeug.utils import secure_filename
from flask_cors import CORS
import os
import pymysql
import json
from profanityAI import censor_profanity  # AI สำหรับเซ็นเซอร์คำหยาบ
from imageAI import predict_image  # AI สำหรับตรวจจับภาพโป๊

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = './uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# เชื่อมต่อฐานข้อมูล
connection = pymysql.connect(
    host='localhost',
    user='root',
    password='1234',
    database='reviewapp',
    charset='utf8mb4',
    cursorclass=pymysql.cursors.DictCursor
)


# ฟังก์ชันสำหรับเซ็นเซอร์คำหยาบในหลายฟิลด์
def apply_profanity_filter(*fields):
    return [censor_profanity(field) for field in fields]


# ฟังก์ชันสำหรับสร้างโพสต์
@app.route('/ai/posts/create', methods=['POST'])
def create_post():
    try:
        user_id = request.form.get('user_id')
        content = request.form.get('content')
        category = request.form.get('category')
        title = request.form.get('Title')
        product_name = request.form.get('ProductName')
        photos = request.files.getlist('photo')
        videos = request.files.getlist('video')

        # เซ็นเซอร์คำหยาบในเนื้อหา
        censored_content, censored_title, censored_product_name = apply_profanity_filter(
            content, title, product_name)

        # ตรวจสอบภาพโป๊
        photo_urls = []
        for photo in photos:
            photo_path = os.path.join(UPLOAD_FOLDER, secure_filename(photo.filename))
            photo.save(photo_path)
            if predict_image(photo_path):  # ตรวจสอบว่าภาพเป็นโป๊หรือไม่
                os.remove(photo_path)  # ลบภาพที่ไม่เหมาะสม
                return jsonify({"error": "พบภาพโป๊ กรุณาลบภาพดังกล่าวออกจากโพสต์"}), 400
            photo_urls.append(f'/uploads/{secure_filename(photo.filename)}')

        # เก็บ URL ของวิดีโอ
        video_urls = [f'/uploads/{secure_filename(video.filename)}' for video in videos]

        # บันทึกลงฐานข้อมูล
        with connection.cursor() as cursor:
            query = """
                INSERT INTO posts (user_id, content, video_url, photo_url, CategoryID, Title, ProductName)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """
            cursor.execute(query, (user_id, censored_content, json.dumps(video_urls),
                                   json.dumps(photo_urls), category, censored_title, censored_product_name))
            connection.commit()

        return jsonify({
            "message": "โพสต์ถูกสร้างสำเร็จ",
            "user_id": user_id,
            "content": censored_content,
            "category": category,
            "Title": censored_title,
            "ProductName": censored_product_name,
            "photo_urls": photo_urls,
            "video_urls": video_urls
        }), 201

    except Exception as e:
        print(f"Error in create_post: {e}")
        return jsonify({"error": str(e)}), 500


# ฟังก์ชันสำหรับอัปเดตโพสต์
@app.route('/ai/posts/<int:id>', methods=['PUT'])
def update_post(id):
    try:
        user_id = request.form.get('user_id')
        content = request.form.get('content')
        category = request.form.get('category')
        title = request.form.get('Title')
        product_name = request.form.get('ProductName')
        photos = request.files.getlist('photo')
        videos = request.files.getlist('video')

        # เซ็นเซอร์คำหยาบในเนื้อหา
        censored_content, censored_title, censored_product_name = apply_profanity_filter(
            content, title, product_name)

        # ตรวจสอบภาพโป๊
        photo_urls = []
        for photo in photos:
            photo_path = os.path.join(UPLOAD_FOLDER, secure_filename(photo.filename))
            photo.save(photo_path)
            if predict_image(photo_path):  # ตรวจสอบว่าภาพเป็นโป๊หรือไม่
                os.remove(photo_path)  # ลบภาพที่ไม่เหมาะสม
                return jsonify({"error": "พบภาพโป๊ กรุณาลบภาพดังกล่าวออกจากโพสต์"}), 400
            photo_urls.append(f'/uploads/{secure_filename(photo.filename)}')

        # เก็บ URL ของวิดีโอ
        video_urls = [f'/uploads/{secure_filename(video.filename)}' for video in videos]

        # อัปเดตข้อมูลในฐานข้อมูล
        with connection.cursor() as cursor:
            query = """
                UPDATE posts
                SET content = %s, Title = %s, ProductName = %s, CategoryID = %s, video_url = %s, photo_url = %s, updated_at = NOW()
                WHERE id = %s AND user_id = %s
            """
            cursor.execute(query, (censored_content, censored_title, censored_product_name, category,
                                   json.dumps(video_urls), json.dumps(photo_urls), id, user_id))
            connection.commit()

        return jsonify({
            "message": "โพสต์ถูกอัปเดตสำเร็จ",
            "post_id": id,
            "user_id": user_id,
            "content": censored_content,
            "category": category,
            "Title": censored_title,
            "ProductName": censored_product_name,
            "photo_urls": photo_urls,
            "video_urls": video_urls
        }), 200

    except Exception as e:
        print(f"Error in update_post: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5005)

'''
    

if __name__ == '__main__':
    try:
        app.run(host='0.0.0.0', port=5005)

    finally:
        driver.quit()