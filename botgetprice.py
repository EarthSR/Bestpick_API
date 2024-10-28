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
    engine = create_engine('mysql+mysqlconnector://bestpick_user:bestpick7890@localhost/reviewapp')
    
    # ดึงข้อมูลจากฐานข้อมูล
    query = "SELECT * FROM clean_new_view;"
    data = pd.read_sql(query, con=engine)  
    return data

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

# โหลดโมเดลและ vectorizer จากไฟล์ .pkl
with open('thai_profanity_model.pkl', 'rb') as model_file:
    model, vectorizer = pickle.load(model_file)

# ฟังก์ชันสำหรับการเซ็นเซอร์คำหยาบในประโยค
def censor_profanity(sentence):
    """
    ฟังก์ชันนี้รับประโยค (sentence) เป็น input 
    และจะเซ็นเซอร์คำที่เป็นคำหยาบโดยแทนที่ด้วยเครื่องหมาย '*'
    สำหรับคำที่ไม่หยาบจะคงค่าเดิมไว้
    """
    words = word_tokenize(sentence, engine="newmm")
    censored_words = []

    for word in words:
        try:
            word_vectorized = vectorizer.transform([word])
        except Exception:
            censored_words.append(word)
            continue

        if word_vectorized.nnz == 0:
            censored_words.append(word)
            continue

        prediction = model.predict(word_vectorized)

        if prediction[0] == 1:
            censored_words.append('*' * len(word))
            print(f"Censored: {word} -> {'*' * len(word)}")  # เพิ่มการพิมพ์คำหยาบที่ถูกเซ็นเซอร์
        else:
            censored_words.append(word)

    return ''.join(censored_words)


# ฟังก์ชันดึงข้อมูลจากฐานข้อมูลและเซ็นเซอร์
def fetch_and_censor_from_db():

    engine = create_engine('mysql+mysqlconnector://bestpick_user:bestpick7890@localhost/reviewapp')

    # ดึงข้อมูลจากฐานข้อมูล (ปรับ query ตามที่ต้องการ)
    query = "SELECT id, Title, content FROM posts WHERE status='active';"
    posts = pd.read_sql(query, con=engine)

    # เซ็นเซอร์ title และ content ของแต่ละโพสต์
    posts['censored_title'] = posts['Title'].apply(censor_profanity)
    posts['censored_content'] = posts['content'].apply(censor_profanity)

    # แสดงผลลัพธ์ที่เซ็นเซอร์แล้ว
    for _, row in posts.iterrows():
        print(f"Post ID: {row['id']}")
        print(f"Censored Title: {row['censored_title']}")
        print(f"Censored Content: {row['censored_content']}")
        print("-" * 30)

# เรียกใช้ฟังก์ชันโดยตรง
if __name__ == "__main__":
    fetch_and_censor_from_db()

#แก้6

@app.route('/ai/recommend', methods=['POST'])
@verify_token
def recommend():
    try:
        user_id = request.user_id
        post_scores = recommend_posts_for_user(user_id)

        if not post_scores:
            return jsonify({"error": "No recommendations found"}), 404

        # เตรียม post_ids จาก post_scores
        post_ids = [post_id for post_id, _ in post_scores]

        # ตรวจสอบว่า post_ids ถูกต้อง
        print("Post IDs for database query:", post_ids)

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

        # ใช้ post_scores เพื่อจัดเรียงโพสต์ตามคะแนน
        sorted_posts = sorted(posts, key=lambda x: post_scores[post_ids.index(x['id'])][1], reverse=True)

        recommendations = []
        for post in sorted_posts:
            # เซ็นเซอร์คำหยาบใน title และ content
            censored_title = censor_profanity(post['Title'])
            censored_content = censor_profanity(post['content'])

            # สร้างรายการแนะนำโพสต์
            recommendations.append({
                "id": post['id'],
                "userId": post['user_id'],
                "title": censored_title,
                "content": censored_content,
                "updated": post['updated_at'].astimezone(timezone.utc).replace(microsecond=0).isoformat() + 'Z',
                "photo_url": json.loads(post.get('photo_url', '[]')),
                "video_url": json.loads(post.get('video_url', '[]')),
                "userName": post['username'],
                "userProfileUrl": post['picture'],
                "is_liked": post['is_liked'] > 0
            })

        return jsonify(recommendations)

    except Exception as e:
        # พิมพ์ข้อความ error ใน Console เพื่อให้คุณเห็นรายละเอียด
        print("Error in recommend function:", e)
        # ส่งข้อความ error กลับไปในรูปแบบ JSON
        return jsonify({"error": "Internal Server Error"}), 500






if __name__ == '__main__':
    try:
        app.run(host='0.0.0.0', port=5000)

    finally:
        driver.quit()