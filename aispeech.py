from flask import Flask, request, jsonify
import pickle
import re

app = Flask(__name__)

# โหลดโมเดลและ vectorizer จากไฟล์ .pkl
MODEL_PATH = 'thai_profanity_model.pkl'
with open(MODEL_PATH, 'rb') as model_file:
    model, vectorizer = pickle.load(model_file)

# ฟังก์ชันสำหรับเซ็นเซอร์คำหยาบในประโยค
def censor_profanity(sentence):
    words = sentence.split()
    contains_profanity = False

    # ตรวจสอบคำหยาบ
    for word in words:
        # แปลงคำเป็นเวกเตอร์ด้วย vectorizer
        word_vector = vectorizer.transform([word])

        # ทำนายว่าคำเป็นคำหยาบหรือไม่
        prediction = model.predict(word_vector)
        
        # หากมีคำหยาบ (ระดับ 1 หรือ 2) ให้เปลี่ยนค่า contains_profanity และหยุดการตรวจสอบเพิ่มเติม
        if prediction[0] in [1, 2]:
            contains_profanity = True
            break

    # หากมีคำหยาบในประโยค เซ็นเซอร์ทั้งประโยค
    if contains_profanity:
        return '*' * len(sentence)  # เซ็นเซอร์ทั้งประโยคด้วย *
    else:
        return sentence  # คืนค่าเดิมถ้าไม่มีคำหยาบ

# สร้าง API สำหรับการเซ็นเซอร์คำหยาบ
@app.route('/censor', methods=['POST'])
def censor():
    data = request.get_json()
    sentence = data.get('sentence', '')

    # เซ็นเซอร์คำหยาบในประโยค
    censored_sentence = censor_profanity(sentence)
    return jsonify({
        'original': sentence,
        'censored': censored_sentence
    })

if __name__ == '__main__':
    app.run(debug=True)
