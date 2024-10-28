import sys
import pickle
from pythainlp import word_tokenize  
from sqlalchemy import create_engine
from sqlalchemy.sql import text
import pandas as pd
import pickle
import io

# Set standard output and error encoding to UTF-8
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

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
        except Exception as e:
            censored_words.append(word)  # คืนค่าคำเดิมหากมีปัญหาในการประมวลผล
            continue

        if word_vectorized.nnz == 0:
            censored_words.append(word)  # คำที่ไม่สามารถแปลงเป็นฟีเจอร์ได้
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

    engine = create_engine('mysql+mysqlconnector://root:1234@localhost/ReviewAPP')

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
