import tensorflow as tf
import numpy as np
from tensorflow.keras.utils import load_img, img_to_array

# โหลดโมเดล
model_image = tf.keras.models.load_model('nude_classifier_model.h5')

# ฟังก์ชันตรวจสอบภาพโป๊
def predict_image(image_path):
    img = load_img(image_path, target_size=(128, 128))  # เปลี่ยนขนาดเป็น 128x128
    img_array = img_to_array(img) / 255.0              # แปลงภาพเป็น array และ normalize
    img_array = np.expand_dims(img_array, axis=0)      # เพิ่มมิติที่ 0 (batch size)
    prediction = model_image.predict(img_array)       # ส่งเข้าโมเดล
    return 'โป๊' if prediction[0][0] > 0.5 else 'ไม่โป๊'

# ใช้งานฟังก์ชัน
if __name__ == "__main__":
    import sys
    image_path = sys.argv[1]  # รับพาธของภาพจาก argument
    result = predict_image(image_path)
    print(f"ผลลัพธ์: {result}")
