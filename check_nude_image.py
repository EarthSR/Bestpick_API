import tensorflow as tf
from tensorflow.keras.preprocessing.image import img_to_array, load_img
import sys

# โหลดโมเดลสำหรับตรวจสอบภาพโป๊
model_image = tf.keras.models.load_model('nude_classifier_model.h5')

def predict_image(image_path):
    img = load_img(image_path, target_size=(150, 150))
    img_array = img_to_array(img) / 255.0
    img_array = tf.expand_dims(img_array, axis=0)
    prediction = model_image.predict(img_array)
    return 'โป๊' if prediction[0][0] > 0.5 else 'ไม่โป๊'

if __name__ == '__main__':
    # รับ path ของไฟล์รูปภาพจาก argument
    image_path = sys.argv[1]
    result = predict_image(image_path)
    print(result)
