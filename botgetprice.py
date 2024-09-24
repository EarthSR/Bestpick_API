from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from bs4 import BeautifulSoup
import requests
import time

# Set up Selenium driver
chrome_options = Options()
chrome_options.add_argument("--headless")  # Run in headless mode (without opening the browser window)

# Path to your ChromeDriver
chrome_service = Service("C:/chromedriver/chromedriver.exe")  # Specify your chromedriver path here

driver = webdriver.Chrome(service=chrome_service, options=chrome_options)

# Function to search and scrape the first product name and price from Advice's website
def search_and_scrape_advice_product(product_name):
    # Step 1: Build the search URL for Advice
    search_url = f"https://www.advice.co.th/search?keyword={product_name.replace(' ', '%20')}"
    print(f"Searching Advice for product: {search_url}")

    # Step 2: Use Selenium to fetch the page
    driver.get(search_url)
    
    # Allow some time for the JavaScript to load the products
    time.sleep(3)

    # Step 3: Parse the loaded HTML with BeautifulSoup
    soup = BeautifulSoup(driver.page_source, 'html.parser')

    # Step 4: Extract product details of the first product
    first_product_div = soup.find('div', {'class': 'item'})  # Get only the first product

    if first_product_div:
        # Extract the product name
        product_name = first_product_div.get('item-name')

        # Extract the price from the "online-price" div
        price_tag = first_product_div.find('div', {'class': 'sales-price sales-price-font'})
        product_price = price_tag.text.strip() if price_tag else "Price not found"

        # Output the product details
        print(f"[Advice] First Product: {product_name}")
        print(f"[Advice] Price: {product_price} บาท")
        print("-" * 40)
    else:
        print("No products found on Advice")

# Function to search for a product on JIB's website and get its details from the search results page
def search_and_scrape_jib_product_from_search(product_name):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    
    # Step 1: Search for the product on JIB (replace spaces with %20 for URL encoding)
    search_url = f"https://www.jib.co.th/web/product/product_search/0?str_search={product_name.replace(' ', '%20')}"
    
    print(f"Searching JIB for product: {search_url}")
    
    response = requests.get(search_url, headers=headers)
    if response.status_code == 200:
        soup = BeautifulSoup(response.text, 'html.parser')
        
        try:
            # Step 2: Find the first product name in the search results
            product_name_tag = soup.find('span', {'class': 'promo_name'})
            if product_name_tag:
                found_product_name = product_name_tag.text.strip()
                print(f"[JIB] Product Name: {found_product_name}")
            else:
                print("Product name not found in JIB search results.")
        
            # Step 3: Find the product price in the search results
            price_tag = soup.find('p', {'class': 'price_total'})
            if price_tag:
                product_price = price_tag.text.strip() + " บาท"
                print(f"[JIB] Product Price: {product_price}")
            else:
                print("Product price not found in JIB search results.")
        except Exception as e:
            print(f"Error occurred while parsing the page: {e}")
    else:
        print(f"Failed to search JIB. Status code: {response.status_code}")
        

# Main loop for user input
while True:
    print("Enter Name of Product (or type 'exit' to quit):")
    productname = input().strip()
    
    if productname.lower() == 'exit':
        print("Exiting...")
        break
    
    # Search on Advice
    search_and_scrape_advice_product(productname)
    
    # Search on JIB
    search_and_scrape_jib_product_from_search(productname)

# Close the driver when done
driver.quit()
