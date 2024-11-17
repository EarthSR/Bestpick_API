from flask import Flask, request, jsonify
import tensorflow as tf
from tensorflow.keras.preprocessing.image import img_to_array, load_img
import numpy as np
import os
from werkzeug.utils import secure_filename
import pymysql
import pickle
from pythainlp import word_tokenize
import json

# โหลดโมเดลตรวจสอบภาพโป๊
model_image = tf.keras.models.load_model('nude_classifier_model.h5')

# โหลดโมเดลกรองคำหยาบ
with open('profanity_model.pkl', 'rb') as model_file:
    model_profanity, vectorizer_profanity = pickle.load(model_file)

# การตั้งค่าฐานข้อมูล
db = pymysql.connect(
    host="localhost",
    user="root",
    password="1234",
    database="reviewapp"
)
cursor = db.cursor()

# สร้าง Flask app
app = Flask(__name__)

# ฟังก์ชันตรวจสอบภาพโป๊
def predict_image(image_path):
    try:
        img = load_img(image_path, target_size=(150, 150))
        img_array = img_to_array(img) / 255.0
        img_array = np.expand_dims(img_array, axis=0)

        prediction = model_image.predict(img_array)
        return 'โป๊' if prediction[0][0] > 0.5 else 'ไม่โป๊'
    except Exception as e:
        return f"Error processing image: {e}"

# ฟังก์ชันเซ็นเซอร์คำหยาบ
def censor_profanity(sentence):
    try:
        words = word_tokenize(sentence, engine="newmm")
        censored_words = []

        for word in words:
            word_vectorized = vectorizer_profanity.transform([word])
            prediction = model_profanity.predict(word_vectorized)

            if prediction[0] == 1:  # คำหยาบ
                censored_words.append('*' * len(word))
            else:
                censored_words.append(word)

        return ''.join(censored_words)
    except Exception as e:
        return f"Error processing profanity: {e}"

# สร้างโพสต์ใหม่
@app.route('/ai/posts/create', methods=['POST'])
def create_post():
    try:
        user_id = request.form.get('user_id')
        title = request.form.get('Title')
        content = request.form.get('content')
        product_name = request.form.get('ProductName')
        category = request.form.get('CategoryID')

        if not all([user_id, title, content, product_name]):
            return jsonify({'error': 'Missing required fields'}), 400

        # เซ็นเซอร์คำหยาบ
        censored_title = censor_profanity(title)
        censored_content = censor_profanity(content)

        photo_urls = []
        video_urls = []

        # อัปโหลดรูปภาพและตรวจสอบภาพโป๊
        if 'photos' in request.files:
            photos = request.files.getlist('photos')
            for photo in photos:
                filename = secure_filename(photo.filename)
                photo_path = os.path.join('uploads', filename)
                photo.save(photo_path)

                # ตรวจสอบภาพโป๊
                moderation_result = predict_image(photo_path)
                if moderation_result == 'โป๊':
                    os.remove(photo_path)
                    return jsonify({'error': 'รูปภาพไม่เหมาะสม กรุณาเปลี่ยนรูป'}), 400

                photo_urls.append(photo_path)

        # อัปโหลดวิดีโอ
        if 'videos' in request.files:
            videos = request.files.getlist('videos')
            for video in videos:
                filename = secure_filename(video.filename)
                video_path = os.path.join('uploads', filename)
                video.save(video_path)
                video_urls.append(video_path)

        # บันทึกลงในฐานข้อมูล
        photo_urls_json = json.dumps(photo_urls)
        video_urls_json = json.dumps(video_urls)
        query = """
            INSERT INTO posts (user_id, Title, content, ProductName, CategoryID, video_url, photo_url)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """
        cursor.execute(query, (user_id, censored_title, censored_content, product_name, category, video_urls_json, photo_urls_json))
        db.commit()

        return jsonify({
            'message': 'สร้างโพสต์สำเร็จ',
            'post_id': cursor.lastrowid,
            'censored_title': censored_title,
            'censored_content': censored_content,
            'photo_urls': photo_urls,
            'video_urls': video_urls
        }), 201

    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500

# อัปเดตโพสต์
@app.route('/ai/posts/<int:id>', methods=['PUT'])
def update_post(id):
    try:
        user_id = request.form.get('user_id')
        title = request.form.get('Title')
        content = request.form.get('content')
        product_name = request.form.get('ProductName')
        category = request.form.get('CategoryID')
        existing_photos = json.loads(request.form.get('existing_photos', '[]'))
        existing_videos = json.loads(request.form.get('existing_videos', '[]'))

        if not all([user_id, title, content, product_name]):
            return jsonify({'error': 'Missing required fields'}), 400

        # ตรวจสอบว่าโพสต์มีอยู่และผู้ใช้เป็นเจ้าของ
        cursor.execute("SELECT user_id FROM posts WHERE id = %s", (id,))
        result = cursor.fetchone()
        if not result:
            return jsonify({'error': 'Post not found'}), 404
        if int(result[0]) != int(user_id):
            return jsonify({'error': 'You are not authorized to update this post'}), 403

        # เซ็นเซอร์คำหยาบ
        censored_title = censor_profanity(title)
        censored_content = censor_profanity(content)

        photo_urls = existing_photos if isinstance(existing_photos, list) else []
        video_urls = existing_videos if isinstance(existing_videos, list) else []

        # อัปโหลดรูปภาพและตรวจสอบภาพโป๊
        if 'photos' in request.files:
            photos = request.files.getlist('photos')
            for photo in photos:
                filename = secure_filename(photo.filename)
                photo_path = os.path.join('uploads', filename)
                photo.save(photo_path)

                # ตรวจสอบภาพโป๊
                moderation_result = predict_image(photo_path)
                if moderation_result == 'โป๊':
                    os.remove(photo_path)
                    return jsonify({'error': 'รูปภาพไม่เหมาะสม กรุณาเปลี่ยนรูป'}), 400

                photo_urls.append(photo_path)

        # อัปเดตในฐานข้อมูล
        photo_urls_json = json.dumps(photo_urls)
        video_urls_json = json.dumps(video_urls)
        query = """
            UPDATE posts
            SET Title = %s, content = %s, ProductName = %s, CategoryID = %s, video_url = %s, photo_url = %s, updated_at = NOW()
            WHERE id = %s
        """
        cursor.execute(query, (censored_title, censored_content, product_name, category, video_urls_json, photo_urls_json, id))
        db.commit()

        return jsonify({
            'message': 'อัปเดตโพสต์สำเร็จ',
            'post_id': id,
            'censored_title': censored_title,
            'censored_content': censored_content,
            'photo_urls': photo_urls,
            'video_urls': video_urls
        }), 200

    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 500


if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000, debug=True)
