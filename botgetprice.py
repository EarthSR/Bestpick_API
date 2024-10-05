from flask import Flask, request, jsonify
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from bs4 import BeautifulSoup
import requests
import time
import os
import threading

# Initialize Flask app
app = Flask(__name__)

# Set up Selenium driver
chrome_options = Options()
chrome_options.add_argument("--headless")  # Run in headless mode (without opening the browser window)
chrome_driver_path = os.getenv('CHROME_DRIVER_PATH', "C:/chromedriver/chromedriver.exe")  # Use env var or default path
chrome_service = Service(chrome_driver_path)
driver = webdriver.Chrome(service=chrome_service, options=chrome_options)

# Function to search and scrape Advice products
def search_and_scrape_advice_product(product_name, results):
    try:
        search_url = f"https://www.advice.co.th/search?keyword={product_name.replace(' ', '%20')}"
        driver.get(search_url)
        time.sleep(3)
        soup = BeautifulSoup(driver.page_source, 'html.parser')
        product_divs = soup.find_all('div', {'class': 'item'})  # Get all product divs
        products = []

        for product_div in product_divs:
            # Extract product details
            product_name = product_div.get('item-name')
            price_tag = product_div.find('div', {'class': 'sales-price sales-price-font'})
            product_price = price_tag.text.strip() if price_tag else "Price not found"

            # Extract product URL
            product_url = product_div.find('a', {'class': 'product-item-link'})['href']
            
            products.append({"name": product_name, "price": product_price, "url": product_url})

        results['Advice'] = products
    except Exception as e:
        results['Advice'] = f"Error occurred during Advice scraping: {e}"

# Function to search and scrape JIB products
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
                # Extract product details
                product_name_tag = product_container.find('span', {'class': 'promo_name'})
                found_product_name = product_name_tag.text.strip() if product_name_tag else "Product name not found"
                price_tag = product_container.find('p', {'class': 'price_total'})
                product_price = price_tag.text.strip() + " บาท" if price_tag else "Price not found"

                # Extract product URL
                productsearch = product_container.find('div',{'class':'row size_img center'})
                product_url = productsearch.find('a')['href']

                products.append({"name": found_product_name, "price": product_price, "url": product_url})

            results['JIB'] = products
        else:
            results['JIB'] = f"Failed to search JIB. Status code: {response.status_code}"
    except Exception as e:
        results['JIB'] = f"Error occurred during JIB scraping: {e}"

# Function to search and scrape Banana IT's products
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
                price_tag = item.find('div', {'class': 'product-price'})
                product_price = price_tag.text.strip() if price_tag else "Price not found"
                products.append({"name": found_product_name, "price": product_price, "url": product_url})

            results['Banana'] = products
        else:
            results['Banana'] = f"Failed to search Banana IT. Status code: {response.status_code}"
    except Exception as e:
        results['Banana'] = f"Error occurred during Banana IT scraping: {e}"

# Replace Unicode Baht symbol in product prices
def replace_baht_symbol(products):
    for product in products:
        if 'price' in product:
            product['price'] = product['price'].replace("\u0e3f", "฿")
    return products

# Flask route for searching products across all websites
@app.route('/search', methods=['GET'])
def search_product():
    product_name = request.args.get('productname')
    if not product_name:
        return jsonify({"error": "Please provide a product name"}), 400

    # Shared results dictionary to store the output from each thread
    results = {}

    # Start threads for concurrent scraping
    advice_thread = threading.Thread(target=search_and_scrape_advice_product, args=(product_name, results))
    jib_thread = threading.Thread(target=search_and_scrape_jib_product_from_search, args=(product_name, results))
    banana_thread = threading.Thread(target=search_and_scrape_banana_product, args=(product_name, results))

    # Start the threads
    advice_thread.start()
    jib_thread.start()
    banana_thread.start()

    # Wait for all threads to complete
    advice_thread.join()
    jib_thread.join()
    banana_thread.join()

    # Post-processing: replace Unicode Baht symbols
    if isinstance(results.get('Advice'), list):
        results['Advice'] = replace_baht_symbol(results['Advice'])
    if isinstance(results.get('JIB'), list):
        results['JIB'] = replace_baht_symbol(results['JIB'])
    if isinstance(results.get('Banana'), list):
        results['Banana'] = replace_baht_symbol(results['Banana'])

    # Return combined results as JSON
    return jsonify(results)

# Main function to run the Flask server
if __name__ == '__main__':
    try:
        app.run(port=5000, debug=True)
    finally:
        driver.quit()
