from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import tensorflow as tf
import numpy as np
from tensorflow.keras.utils import load_img, img_to_array
import pickle
from pythainlp import word_tokenize
import os

# โหลดโมเดล TensorFlow สำหรับตรวจสอบภาพโป๊
model_image = tf.keras.models.load_model('nude_classifier_model.h5')

# โหลดโมเดลสำหรับตรวจสอบคำหยาบ
with open('profanity_model.pkl', 'rb') as model_file:
    model_profanity, vectorizer_profanity = pickle.load(model_file)

app = Flask(__name__)
CORS(app)  # เปิดใช้งาน CORS
UPLOAD_FOLDER = '/var/www/html/bestpick/nodejs/Bestpick_API/uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# ฟังก์ชันตรวจสอบภาพโป๊
def predict_image(image_path):
    try:
        img = load_img(image_path, target_size=(128, 128))  # เปลี่ยนขนาดเป็น 128x128
        img_array = img_to_array(img) / 255.0              # แปลงภาพเป็น array และ normalize
        img_array = np.expand_dims(img_array, axis=0)      # เพิ่มมิติที่ 0 (batch size)
        prediction = model_image.predict(img_array)       # ส่งเข้าโมเดล
        return prediction[0][0] > 0.5  # True = "โป๊", False = "ไม่โป๊"
    except Exception as e:
        print(f"Error in predict_image: {e}")
        return False

# ฟังก์ชันเซ็นเซอร์คำหยาบ
def censor_profanity(sentence):
    try:
        words = word_tokenize(sentence, engine="newmm")
        censored_words = [
            '*' * len(word) if model_profanity.predict(vectorizer_profanity.transform([word]))[0] == 1 else word
            for word in words
        ]
        censored_sentence = ''.join(censored_words)
        has_profanity = any(
            model_profanity.predict(vectorizer_profanity.transform([word]))[0] == 1 for word in words
        )
        return censored_sentence, has_profanity
    except Exception as e:
        print(f"Error in censor_profanity: {e}")
        return sentence, False

# Endpoint สำหรับสร้างโพสต์
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

        print(f"Request Data: user_id={user_id}, content={content}, category={category}, title={title}, product_name={product_name}")

        # ตรวจสอบคำหยาบและเซ็นเซอร์
        censored_content, has_profanity = censor_profanity(content)
        if has_profanity:
            return jsonify({"error": "โพสต์มีคำหยาบ กรุณาแก้ไขเนื้อหา"}), 400

        # ตรวจสอบภาพโป๊
        for photo in photos:
            photo_path = os.path.join(UPLOAD_FOLDER, photo.filename)
            photo.save(photo_path)
            if predict_image(photo_path):
                os.remove(photo_path)
                return jsonify({"error": "พบภาพโป๊ กรุณาลบภาพดังกล่าวออกจากโพสต์"}), 400

        # บันทึก URL ของรูปภาพและวิดีโอ
        photo_urls = [f'/uploads/{photo.filename}' for photo in photos]
        video_urls = [f'/uploads/{video.filename}' for video in videos]

        # Mock response (เก็บข้อมูลในฐานข้อมูล)
        return jsonify({
            "message": "โพสต์ถูกสร้างสำเร็จ",
            "user_id": user_id,
            "content": censored_content,
            "category": category,
            "Title": title,
            "ProductName": product_name,
            "photo_urls": photo_urls,
            "video_urls": video_urls
        }), 201

    except Exception as e:
        print(f"Error in create_post: {e}")
        return jsonify({"error": str(e)}), 500

# Endpoint สำหรับให้บริการไฟล์ที่อัปโหลด
@app.route('/uploads/<filename>')
def uploaded_file(filename):
    try:
        return send_from_directory(UPLOAD_FOLDER, filename)
    except Exception as e:
        print(f"Error in uploaded_file: {e}")
        return jsonify({"error": "File not found"}), 404

# Endpoint สำหรับอัปเดตโพสต์
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

        print(f"Update Post: id={id}, user_id={user_id}, content={content}, category={category}, title={title}, product_name={product_name}")

        # ตรวจสอบคำหยาบ
        censored_content, has_profanity = censor_profanity(content)
        if has_profanity:
            return jsonify({"error": "โพสต์มีคำหยาบ กรุณาแก้ไขเนื้อหา"}), 400

        # ตรวจสอบภาพโป๊
        for photo in photos:
            photo_path = os.path.join(UPLOAD_FOLDER, photo.filename)
            photo.save(photo_path)
            if predict_image(photo_path):
                os.remove(photo_path)
                return jsonify({"error": "พบภาพโป๊ กรุณาลบภาพดังกล่าวออกจากโพสต์"}), 400

        # บันทึก URL ของรูปภาพและวิดีโอ
        photo_urls = [f'/uploads/{photo.filename}' for photo in photos]
        video_urls = [f'/uploads/{video.filename}' for video in videos]

        # Mock response (อัปเดตในฐานข้อมูล)
        return jsonify({
            "message": "โพสต์ถูกอัปเดตสำเร็จ",
            "post_id": id,
            "user_id": user_id,
            "content": censored_content,
            "category": category,
            "Title": title,
            "ProductName": product_name,
            "photo_urls": photo_urls,
            "video_urls": video_urls
        }), 200

    except Exception as e:
        print(f"Error in update_post: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5005)
