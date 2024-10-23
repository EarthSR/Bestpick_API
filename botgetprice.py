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
import joblib
import pandas as pd

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

# โหลดข้อมูล
data = pd.read_csv('clean_new.csv')

# ฟังก์ชันสำหรับแนะนำโพสต์ตามเนื้อหาที่คล้ายกัน
def content_based_recommendations(post_id, cosine_sim=cosine_sim):
    try:
        idx = data.index[data['post_id'] == post_id][0]
        sim_scores = list(enumerate(cosine_sim[idx]))
        sim_scores = sorted(sim_scores, key=lambda x: x[1], reverse=True)
        sim_scores = sim_scores[1:11]  # แนะนำโพสต์ที่คล้ายที่สุด 10 อันดับแรก
        post_indices = [i[0] for i in sim_scores]
        return data['post_id'].iloc[post_indices]
    except IndexError:
        return []

# ฟังก์ชัน Hybrid สำหรับแนะนำโพสต์
def hybrid_recommendations(user_id, post_id, alpha=0.7):
    collab_pred = collaborative_model.predict(user_id, post_id).est
    content_recs = content_based_recommendations(post_id)
    
    # พิมพ์ผลลัพธ์แต่ละส่วนออกมา
    print(f"Collaborative score for post {post_id}: {collab_pred}")
    content_pred = 1 if post_id in content_recs else 0
    print(f"Content score for post {post_id}: {content_pred}")
    
    final_score = alpha * collab_pred + (1 - alpha) * content_pred
    return final_score


# ฟังก์ชันสำหรับแนะนำโพสต์ให้ผู้ใช้ โดยเรียงลำดับโพสต์ตามคะแนนจากมากไปน้อย
def recommend_posts_for_user(user_id, alpha=0.7):
    post_scores = []
    
    # วนผ่านโพสต์ทั้งหมดเพื่อคำนวณคะแนนการแนะนำ
    for post_id in data['post_id'].unique():
        score = hybrid_recommendations(user_id, post_id, alpha=alpha)
        post_scores.append((int(post_id), score))  # แปลง post_id เป็น int เพื่อความปลอดภัยในการ serialize
    
    # เรียงลำดับโพสต์ตามคะแนนจากมากไปน้อย
    post_scores = sorted(post_scores, key=lambda x: x[1], reverse=True)
    
    return post_scores

# API endpoint สำหรับแนะนำโพสต์ให้ผู้ใช้
@app.route('/recommend', methods=['POST'])
def recommend():
    user_id = request.json.get('user_id')
    
    # ตรวจสอบว่า user_id มีอยู่หรือไม่
    if user_id is None:
        return jsonify({"error": "user_id is required"}), 400
    
    # แสดงทุกโพสต์ที่เรียงตามคะแนนมากไปน้อย
    recommended_posts = recommend_posts_for_user(user_id)
    
    # ส่งกลับเป็น JSON
    recommendations = [{"post_id": post_id, "score": score} for post_id, score in recommended_posts]
    return jsonify({"recommendations": recommendations})


if __name__ == '__main__':
    try:
        app.run(host='0.0.0.0', port=5000)

    finally:
        driver.quit()
