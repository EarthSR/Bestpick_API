from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from bs4 import BeautifulSoup
import requests
import time
import os

# Set up Selenium driver
chrome_options = Options()
chrome_options.add_argument("--headless")  # Run in headless mode (without opening the browser window)

# Path to your ChromeDriver
chrome_driver_path = os.getenv('CHROME_DRIVER_PATH', "C:/chromedriver/chromedriver.exe")  # Use env var or default path
chrome_service = Service(chrome_driver_path)

driver = webdriver.Chrome(service=chrome_service, options=chrome_options)

# Function to search and scrape multiple product names and prices from Advice's website
def search_and_scrape_advice_product(product_name):
    try:
        # Step 1: Build the search URL for Advice
        search_url = f"https://www.advice.co.th/search?keyword={product_name.replace(' ', '%20')}"
        print(f"Searching Advice for product: {search_url}")

        # Step 2: Use Selenium to fetch the page
        driver.get(search_url)

        # Allow some time for the JavaScript to load the products
        time.sleep(3)

        # Step 3: Parse the loaded HTML with BeautifulSoup
        soup = BeautifulSoup(driver.page_source, 'html.parser')

        # Step 4: Extract multiple products' details
        product_divs = soup.find_all('div', {'class': 'item'})  # Get all product divs
        products = []

        for product_div in product_divs:
            # Extract the product name
            product_name = product_div.get('item-name')

            # Extract the price from the "online-price" div
            price_tag = product_div.find('div', {'class': 'sales-price sales-price-font'})
            product_price = price_tag.text.strip() if price_tag else "Price not found"

            products.append((product_name, product_price))

        if products:
            print("[Advice] Products found:")
            for idx, (name, price) in enumerate(products, start=1):
                print(f"{idx}. {name} - {price} บาท")
            return products
        else:
            print("No products found on Advice")
            return []
    except Exception as e:
        print(f"Error occurred during Advice scraping: {e}")
        return []

# Function to search for a product on JIB's website and get its details from the search results page
def search_and_scrape_jib_product_from_search(product_name):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    
    try:
        # Step 1: Search for the product on JIB (replace spaces with %20 for URL encoding)
        search_url = f"https://www.jib.co.th/web/product/product_search/0?str_search={product_name.replace(' ', '%20')}"
        
        print(f"Searching JIB for product: {search_url}")
        
        response = requests.get(search_url, headers=headers)
        
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Step 2: Find all product containers
            product_containers = soup.find_all('div', {'class': 'divboxpro'})
            products = []

            for product_container in product_containers:
                # Extract the product name
                product_name_tag = product_container.find('span', {'class': 'promo_name'})
                found_product_name = product_name_tag.text.strip() if product_name_tag else "Product name not found"
                
                # Extract the product price
                price_tag = product_container.find('p', {'class': 'price_total'})
                product_price = price_tag.text.strip() + " บาท" if price_tag else "Price not found"
                
                products.append((found_product_name, product_price))

            if products:
                print("[JIB] Products found:")
                for idx, (name, price) in enumerate(products, start=1):
                    print(f"{idx}. {name} - {price}")
                return products
            else:
                print("No products found in JIB search results.")
                return []
        else:
            print(f"Failed to search JIB. Status code: {response.status_code}")
            return []
    except Exception as e:
        print(f"Error occurred during JIB scraping: {e}")
        return []

# Function to search for a product on Banana IT's website and get its details
def search_and_scrape_banana_product(product_name):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    
    try:
        # ใช้ URL ที่ได้รับมาในการค้นหา
        search_url = f"https://www.bnn.in.th/th/p?q={product_name.replace(' ', '%20')}&ref=search-result"
        print(f"Searching Banana IT for product: {search_url}")
        
        response = requests.get(search_url, headers=headers)

        if response.status_code == 200:
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # ค้นหาสินค้าจากโครงสร้าง <div class="product-list">
            product_list = soup.find('div', {'class': 'product-list'})
            if not product_list:
                print("No product list found on the page.")
                return []

            # ดึงสินค้าทั้งหมดจาก product list
            product_items = product_list.find_all('a', {'class': 'product-link verify product-item'})
            products = []

            for item in product_items:
                # ดึง URL สินค้า
                product_url = "https://www.bnn.in.th" + item['href']

                # ดึงชื่อสินค้า
                product_name_tag = item.find('div', {'class': 'product-name'})
                found_product_name = product_name_tag.text.strip() if product_name_tag else "Product name not found"

                # ดึงราคาสินค้า
                price_tag = item.find('div', {'class': 'product-price'})
                product_price = price_tag.text.strip() if price_tag else "Price not found"

                # เพิ่มสินค้าในรายการ
                products.append((found_product_name, product_price, product_url))

            # แสดงผลรายการสินค้าที่พบ
            if products:
                print("[Banana IT] Products found:")
                for idx, (name, price, url) in enumerate(products, start=1):
                    print(f"{idx}. {name} - {price} บาท ")
                return products
            else:
                print("No products found in Banana IT search results.")
                return []
        else:
            print(f"Failed to search Banana IT. Status code: {response.status_code}")
            return []
    except Exception as e:
        print(f"Error occurred during Banana IT scraping: {e}")
        return []



# Main loop for user input and selecting the most relevant product
def main():
    try:
        while True:
            print("Enter Name of Product (or type 'exit' to quit):")
            productname = input().strip()

            if productname.lower() == 'exit':
                print("Exiting...")
                break

            search_and_scrape_advice_product(productname)
            search_and_scrape_jib_product_from_search(productname)
            search_and_scrape_banana_product(productname)

            
    finally:
        # Ensure the driver is closed no matter what happens
        driver.quit()


# Entry point
if __name__ == "__main__":
    main()
