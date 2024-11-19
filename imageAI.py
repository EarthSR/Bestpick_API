import tensorflow as tf
from tensorflow.keras.preprocessing.image import img_to_array, load_img
import numpy as np

# โหลดโมเดล TensorFlow
model_image = tf.keras.models.load_model('nude_classifier_model.h5')

def predict_image(image_path):
    """
    ตรวจสอบว่าภาพเป็นภาพโป๊หรือไม่
    """
    try:
        img = load_img(image_path, target_size=(128, 128))  # เปลี่ยนขนาดภาพ
        img_array = img_to_array(img) / 255.0              # Normalize
        img_array = np.expand_dims(img_array, axis=0)      # เพิ่ม batch dimension
        prediction = model_image.predict(img_array)
        return prediction[0][0] > 0.5  # True = ภาพโป๊, False = ภาพปกติ
    except Exception as e:
        print(f"Error in predict_image: {e}")
        return False
