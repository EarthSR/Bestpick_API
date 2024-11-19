import pandas as pd
import gdown
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
from sklearn.utils import resample
import pickle

# ดาวน์โหลดไฟล์จาก Google Drive
file_url = 'https://drive.google.com/uc?id=1Avgja02ufmpIWYlCoNzWEE0KgjHjPlB7'
output_path = 'profanity_words.xlsx'

try:
    gdown.download(file_url, output_path, quiet=False)
except Exception as e:
    print(f"Error downloading file: {e}")
    exit(1)

# อ่านข้อมูลจาก Excel
try:
    xls = pd.ExcelFile(output_path)
    thai_profanity = xls.parse('Thai_Profanity')['word'].dropna().tolist()
    english_profanity = xls.parse('English_Profanity')['word'].dropna().tolist()
    thai_non_profanity = xls.parse('Thai_Non_Profanity')['word'].dropna().tolist()
    english_non_profanity = xls.parse('English_Non_Profanity')['word'].dropna().tolist()
except Exception as e:
    print(f"Error reading or parsing Excel file: {e}")
    exit(1)

# รวมคำทั้งหมด
words = thai_profanity + english_profanity + thai_non_profanity + english_non_profanity
labels = [1] * (len(thai_profanity) + len(english_profanity)) + [0] * (len(thai_non_profanity) + len(english_non_profanity))

# ตรวจสอบว่ามีคำในแต่ละกลุ่มหรือไม่
if not words or not labels:
    print("Error: No words found in the dataset.")
    exit(1)

# สร้าง DataFrame
data = pd.DataFrame({'word': words, 'label': labels})

# Oversampling คลาส 1 (เพิ่มคำหยาบ)
class_0 = data[data['label'] == 0]
class_1 = data[data['label'] == 1]

if class_1.empty or class_0.empty:
    print("Error: Dataset imbalance issue. One of the classes is empty.")
    exit(1)

class_1_upsampled = resample(class_1, replace=True, n_samples=len(class_0), random_state=42)
data_balanced = pd.concat([class_0, class_1_upsampled])

# แบ่งข้อมูล
train_data, test_data = train_test_split(data_balanced, test_size=0.2, random_state=42)

# สร้าง TfidfVectorizer
try:
    vectorizer = TfidfVectorizer(ngram_range=(1, 3), analyzer='char', min_df=1, max_df=0.9)
    X_train = vectorizer.fit_transform(train_data['word'])
    y_train = train_data['label']
except Exception as e:
    print(f"Error creating TfidfVectorizer: {e}")
    exit(1)

# ใช้ RandomForest
try:
    model = RandomForestClassifier(
        n_estimators=200,
        max_depth=None,
        min_samples_split=5,
        class_weight='balanced',
        random_state=42
    )
    model.fit(X_train, y_train)
except Exception as e:
    print(f"Error training the RandomForest model: {e}")
    exit(1)

# ทดสอบโมเดล
try:
    X_test = vectorizer.transform(test_data['word'])
    y_test = test_data['label']
    y_pred = model.predict(X_test)
    print(classification_report(y_test, y_pred))
except Exception as e:
    print(f"Error testing the model: {e}")
    exit(1)

# บันทึกโมเดลและ Vectorizer
try:
    with open('profanity_model.pkl', 'wb') as model_file:
        pickle.dump((model, vectorizer), model_file)
    print("โมเดลถูกบันทึกในไฟล์ 'profanity_model.pkl'")
except Exception as e:
    print(f"Error saving the model: {e}")
    exit(1)
