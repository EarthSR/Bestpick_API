from flask import Flask, request, jsonify
from werkzeug.utils import secure_filename
from flask_cors import CORS
import os
import pymysql
import json
from profanityAI import censor_profanity  # AI สำหรับเซ็นเซอร์คำหยาบ
from imageAI import predict_image  # AI สำหรับตรวจจับภาพโป๊

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = './uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# เชื่อมต่อฐานข้อมูล
connection = pymysql.connect(
    host='localhost',
    user='root',
    password='1234',
    database='reviewapp',
    charset='utf8mb4',
    cursorclass=pymysql.cursors.DictCursor
)


# ฟังก์ชันสำหรับเซ็นเซอร์คำหยาบในหลายฟิลด์
def apply_profanity_filter(*fields):
    return [censor_profanity(field) for field in fields]


# ฟังก์ชันสำหรับสร้างโพสต์
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

        # เซ็นเซอร์คำหยาบในเนื้อหา
        censored_content, censored_title, censored_product_name = apply_profanity_filter(
            content, title, product_name)

        # ตรวจสอบภาพโป๊
        photo_urls = []
        for photo in photos:
            photo_path = os.path.join(UPLOAD_FOLDER, secure_filename(photo.filename))
            photo.save(photo_path)
            if predict_image(photo_path):  # ตรวจสอบว่าภาพเป็นโป๊หรือไม่
                os.remove(photo_path)  # ลบภาพที่ไม่เหมาะสม
                return jsonify({"error": "พบภาพโป๊ กรุณาลบภาพดังกล่าวออกจากโพสต์"}), 400
            photo_urls.append(f'/uploads/{secure_filename(photo.filename)}')

        # เก็บ URL ของวิดีโอ
        video_urls = [f'/uploads/{secure_filename(video.filename)}' for video in videos]

        # บันทึกลงฐานข้อมูล
        with connection.cursor() as cursor:
            query = """
                INSERT INTO posts (user_id, content, video_url, photo_url, CategoryID, Title, ProductName)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """
            cursor.execute(query, (user_id, censored_content, json.dumps(video_urls),
                                   json.dumps(photo_urls), category, censored_title, censored_product_name))
            connection.commit()

        return jsonify({
            "message": "โพสต์ถูกสร้างสำเร็จ",
            "user_id": user_id,
            "content": censored_content,
            "category": category,
            "Title": censored_title,
            "ProductName": censored_product_name,
            "photo_urls": photo_urls,
            "video_urls": video_urls
        }), 201

    except Exception as e:
        print(f"Error in create_post: {e}")
        return jsonify({"error": str(e)}), 500


# ฟังก์ชันสำหรับอัปเดตโพสต์
@app.route('/ai/posts/<int:id>', methods=['PUT'])
def update_post(id):
    try:
        user_id = request.form.get('user_id')
        content = request.form.get('content')
        category = request.form.get('category')
        title = request.form.get('Title')
        product_name = request.form.get('ProductName')
        existing_photos = json.loads(request.form.get('existing_photos', '[]'))
        existing_videos = json.loads(request.form.get('existing_videos', '[]'))
        photos = request.files.getlist('photo')
        videos = request.files.getlist('video')

        # ตรวจสอบว่า user_id ตรงกับเจ้าของโพสต์หรือไม่
        if not user_id or not str(id).isdigit():
            return jsonify({"error": "Invalid user ID or post ID"}), 400

        # เซ็นเซอร์คำหยาบในฟิลด์ต่าง ๆ
        censored_content, censored_title, censored_product_name = apply_profanity_filter(
            content, title, product_name)

        # รวมไฟล์ภาพและวิดีโอใหม่กับไฟล์ที่มีอยู่
        photo_urls = existing_photos if isinstance(existing_photos, list) else []
        video_urls = existing_videos if isinstance(existing_videos, list) else []

        # ตรวจสอบภาพใหม่
        for photo in photos:
            photo_path = os.path.join(UPLOAD_FOLDER, secure_filename(photo.filename))
            photo.save(photo_path)
            if predict_image(photo_path):  # ตรวจสอบว่าภาพเป็นโป๊หรือไม่
                os.remove(photo_path)  # ลบภาพที่ไม่เหมาะสม
                return jsonify({"error": "พบภาพโป๊ กรุณาลบภาพดังกล่าวออกจากโพสต์"}), 400
            photo_urls.append(f'/uploads/{secure_filename(photo.filename)}')

        # บันทึกวิดีโอใหม่
        for video in videos:
            video_path = os.path.join(UPLOAD_FOLDER, secure_filename(video.filename))
            video.save(video_path)
            video_urls.append(f'/uploads/{secure_filename(video.filename)}')

        # JSON encode URLs
        photo_urls_json = json.dumps(photo_urls)
        video_urls_json = json.dumps(video_urls)

        # อัปเดตโพสต์ในฐานข้อมูล
        with connection.cursor() as cursor:
            query = """
                UPDATE posts
                SET content = %s, Title = %s, ProductName = %s, CategoryID = %s, 
                    video_url = %s, photo_url = %s, updated_at = NOW()
                WHERE id = %s AND user_id = %s
            """
            cursor.execute(query, (censored_content, censored_title, censored_product_name, category,
                                   video_urls_json, photo_urls_json, id, user_id))
            connection.commit()

            # ตรวจสอบว่ามีการอัปเดตหรือไม่
            if cursor.rowcount == 0:
                return jsonify({"error": "Post not found or you are not the owner"}), 404

        return jsonify({
            "message": "โพสต์ถูกอัปเดตสำเร็จ",
            "post_id": id,
            "user_id": user_id,
            "content": censored_content,
            "category": category,
            "Title": censored_title,
            "ProductName": censored_product_name,
            "photo_urls": photo_urls,
            "video_urls": video_urls
        }), 200

    except Exception as e:
        print(f"Error in update_post: {e}")
        return jsonify({"error": str(e)}), 500



if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5005)
