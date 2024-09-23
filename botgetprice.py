import requests
from bs4 import BeautifulSoup

# Function to search for a product on JIB's website and get its details from the search results page
def search_and_scrape_jib_product_from_search(product_name):
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    
    # Step 1: Search for the product on JIB (insert the product name in the URL)
    search_url = f"https://www.jib.co.th/web/product/product_search/0?str_search={product_name}"
    
    print(f"Searching for product: {search_url}")
    
    response = requests.get(search_url, headers=headers)
    if response.status_code == 200:
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Step 2: Find the first product name in the search results
        product_name_tag = soup.find('span', {'class': 'promo_name'})
        if product_name_tag:
            found_product_name = product_name_tag.text.strip()
            print(f"Product Name: {found_product_name}")
        else:
            print("Product name not found in search results.")
        
        # Step 3: Find the product price in the search results
        price_tag = soup.find('p', {'class': 'price_total'})
        if price_tag:
            product_price = price_tag.text.strip() + " บาท"
            print(f"Product Price: {product_price}")
        else:
            print("Product price not found in search results.")
        
    else:
        print(f"Failed to search JIB. Status code: {response.status_code}")

# Example usage:
search_and_scrape_jib_product_from_search("MSI CYBORG 15 A12VE")
